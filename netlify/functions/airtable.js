const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';
const RETRYABLE_STATUS = 429;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 500;

const requiredEnv = [
  'AIRTABLE_API_KEY',
  'AIRTABLE_BASE_ID',
  'BOARDS_TABLE_ID',
  'SESSIONS_TABLE_ID',
  'TOPICS_TABLE_ID',
  'VOTES_TABLE_ID',
  'COMMENTS_TABLE_ID',
  'USERS_TABLE_ID',
];

const env = {};
for (const key of requiredEnv) {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  env[key] = value;
}

const FIELD_MAP = {
  board: {
    name: 'Name',
    description: 'Description',
    voteLimit: 'VoteLimit',
    state: 'State',
  },
  session: {
    code: 'Code',
    name: 'Name',
    boardId: 'Board',
    facilitatorId: 'Facilitator',
    status: 'Status',
    startedAt: 'StartedAt',
    endedAt: 'EndedAt',
  },
  topic: {
    sessionId: 'Session',
    boardId: 'Board',
    title: 'Title',
    description: 'Description',
    status: 'Status',
    notes: 'Notes',
    authorId: 'Author',
    votes: 'Votes',
    order: 'Order',
  },
  vote: {
    sessionId: 'Session',
    topicId: 'Topic',
    userId: 'User',
    weight: 'Weight',
  },
  comment: {
    sessionId: 'Session',
    topicId: 'Topic',
    userId: 'User',
    body: 'Body',
  },
  user: {
    name: 'Name',
    email: 'Email',
    avatar: 'Avatar',
    role: 'Role',
    externalId: 'ExternalId',
    sessionIds: 'Sessions',
  },
};

function toAirtableFields(data, type) {
  const map = FIELD_MAP[type];
  if (!map) return {};
  const fields = {};
  for (const [key, airtableKey] of Object.entries(map)) {
    const value = data[key];
    if (value === undefined) continue;
    if (airtableKey === 'Board' || airtableKey === 'Session' || airtableKey === 'Topic' || airtableKey === 'User' || airtableKey === 'Facilitator') {
      if (value === null) continue;
      fields[airtableKey] = Array.isArray(value) ? value : [value];
    } else {
      fields[airtableKey] = value;
    }
  }
  return fields;
}

function fromAirtableRecord(record, type) {
  const map = FIELD_MAP[type];
  if (!map) {
    return { id: record.id, fields: record.fields };
  }
  const result = { id: record.id };
  const fields = record.fields || {};
  for (const [key, airtableKey] of Object.entries(map)) {
    if (fields[airtableKey] !== undefined) {
      result[key] = fields[airtableKey];
      if ((airtableKey === 'Board' || airtableKey === 'Session' || airtableKey === 'Topic' || airtableKey === 'User' || airtableKey === 'Facilitator') && Array.isArray(fields[airtableKey])) {
        result[key] = fields[airtableKey];
        if (fields[airtableKey].length === 1) {
          result[key] = fields[airtableKey][0];
        }
      }
    }
  }
  result.raw = record.fields;
  return result;
}

function buildUrl(tableId, recordId, params = {}) {
  const url = new URL(`${AIRTABLE_API_BASE}/${env.AIRTABLE_BASE_ID}/${tableId}${recordId ? `/${recordId}` : ''}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    url.searchParams.append(key, value);
  }
  return url.toString();
}

async function airtableFetch({ tableId, method = 'GET', recordId, params, body }) {
  let attempt = 0;
  let lastError;
  while (attempt <= MAX_RETRIES) {
    const url = buildUrl(tableId, recordId, params);
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${env.AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (response.status === RETRYABLE_STATUS && attempt < MAX_RETRIES) {
      const retryAfterHeader = response.headers.get('Retry-After');
      const retryAfter = retryAfterHeader ? Number(retryAfterHeader) * 1000 : RETRY_BACKOFF_MS * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, retryAfter));
      attempt += 1;
      continue;
    }

    if (!response.ok) {
      const errorPayload = await safeJson(response);
      const err = new AirtableApiError(response.status, errorPayload);
      lastError = err;
      break;
    }

    const payload = await safeJson(response);
    return payload;
  }

  throw lastError || new Error('Unknown Airtable error');
}

async function safeJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    return { message: text };
  }
}

class AirtableApiError extends Error {
  constructor(statusCode, payload) {
    super(payload?.error?.message || payload?.message || 'Airtable request failed');
    this.name = 'AirtableApiError';
    this.statusCode = statusCode;
    this.payload = payload;
  }
}

async function getRecord(tableId, recordId) {
  const record = await airtableFetch({ tableId, recordId });
  return record;
}

async function listRecords(tableId, params = {}) {
  let offset;
  const records = [];
  do {
    const page = await airtableFetch({
      tableId,
      params: {
        ...params,
        offset,
      },
    });
    records.push(...(page.records || []));
    offset = page.offset;
  } while (offset);
  return records;
}

async function createRecord(tableId, fields) {
  const payload = await airtableFetch({
    tableId,
    method: 'POST',
    body: { fields },
  });
  return payload;
}

async function updateRecord(tableId, recordId, fields) {
  const payload = await airtableFetch({
    tableId,
    recordId,
    method: 'PATCH',
    body: { fields },
  });
  return payload;
}

async function deleteRecord(tableId, recordId) {
  const payload = await airtableFetch({
    tableId,
    recordId,
    method: 'DELETE',
  });
  return payload;
}

function ok(body, statusCode = 200) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body ?? {}),
  };
}

function errorResponse(error) {
  if (error instanceof AirtableApiError) {
    return {
      statusCode: error.statusCode || 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message, details: error.payload }),
    };
  }
  return {
    statusCode: 500,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: error.message || 'Internal Server Error' }),
  };
}

function parseBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch (error) {
    throw new Error('Invalid JSON payload');
  }
}

function normalisePath(event) {
  const seen = new Set();
  const candidates = [];
  const addCandidate = (value) => {
    if (!value || typeof value !== 'string' || seen.has(value)) {
      return;
    }
    seen.add(value);
    candidates.push(value);
  };

  addCandidate(event.rawUrl);
  addCandidate(event.rawPath);
  addCandidate(event.path);

  const headers = event.headers || {};
  addCandidate(headers['x-nf-original-pathname']);
  addCandidate(headers['x-nf-original-uri']);
  addCandidate(headers['x-original-uri']);

  const requestContext = event.requestContext || {};
  addCandidate(requestContext.path);
  if (requestContext.http) {
    addCandidate(requestContext.http.path);
    addCandidate(requestContext.http.rawPath);
  }

  let sawRootMatch = false;

  for (const candidate of candidates) {
    const prefixMatch = candidate.match(/\.netlify\/functions\/[^/?#]+/);
    if (!prefixMatch) {
      continue;
    }
    const matchText = prefixMatch[0];
    const start =
      typeof prefixMatch.index === 'number'
        ? prefixMatch.index
        : candidate.indexOf(matchText);
    if (start === -1) {
      continue;
    }
    let trimmed = candidate.slice(start + matchText.length);
    const fragmentIndex = trimmed.search(/[?#]/);
    if (fragmentIndex !== -1) {
      trimmed = trimmed.slice(0, fragmentIndex);
    }
    trimmed = trimmed.trim();
    if (!trimmed) {
      sawRootMatch = true;
      continue;
    }
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  }

  if (sawRootMatch) {
    return '';
  }

  return candidates[0] || '';
}

function linkFilter(field, id) {
  const escaped = id.replace(/'/g, "\\'");
  return `FIND('${escaped}', ARRAYJOIN({${field}})) > 0`;
}

async function findSessionByCode(code) {
  const records = await listRecords(env.SESSIONS_TABLE_ID, {
    filterByFormula: `{Code}='${code.replace(/'/g, "\\'")}'`,
    maxRecords: 1,
  });
  return records[0];
}

async function loadSession(sessionId, query) {
  let sessionRecord;
  if (sessionId) {
    sessionRecord = await getRecord(env.SESSIONS_TABLE_ID, sessionId);
  } else if (query?.code) {
    sessionRecord = (await findSessionByCode(query.code)) || null;
  }

  if (!sessionRecord) {
    return null;
  }

  const session = fromAirtableRecord(sessionRecord, 'session');
  const sessionAirtableId = sessionRecord.id;

  const boardIdField = sessionRecord.fields?.Board;
  const boardId = Array.isArray(boardIdField) ? boardIdField[0] : boardIdField;

  const [boardRecord, topicRecords, voteRecords, commentRecords, userRecords] = await Promise.all([
    boardId ? getRecord(env.BOARDS_TABLE_ID, boardId) : Promise.resolve(null),
    listRecords(env.TOPICS_TABLE_ID, {
      filterByFormula: linkFilter('Session', sessionAirtableId),
    }),
    listRecords(env.VOTES_TABLE_ID, {
      filterByFormula: linkFilter('Session', sessionAirtableId),
    }),
    listRecords(env.COMMENTS_TABLE_ID, {
      filterByFormula: linkFilter('Session', sessionAirtableId),
    }),
    listRecords(env.USERS_TABLE_ID, {
      filterByFormula: linkFilter('Sessions', sessionAirtableId),
    }),
  ]);

  const board = boardRecord ? fromAirtableRecord(boardRecord, 'board') : null;
  const topics = topicRecords.map((record) => fromAirtableRecord(record, 'topic'));
  const votes = voteRecords.map((record) => fromAirtableRecord(record, 'vote'));
  const comments = commentRecords.map((record) => fromAirtableRecord(record, 'comment'));
  const users = userRecords.map((record) => fromAirtableRecord(record, 'user'));

  return {
    session,
    board,
    topics,
    votes,
    comments,
    users,
  };
}

async function handleCreateSession(body) {
  const { board, boardId, session } = body;
  let resolvedBoardId = boardId;

  if (!resolvedBoardId && board) {
    const boardPayload = toAirtableFields(board, 'board');
    const createdBoard = await createRecord(env.BOARDS_TABLE_ID, boardPayload);
    resolvedBoardId = createdBoard.id;
  }

  const sessionFields = toAirtableFields(session || {}, 'session');
  if (resolvedBoardId) {
    sessionFields.Board = [resolvedBoardId];
  }

  const createdSession = await createRecord(env.SESSIONS_TABLE_ID, sessionFields);
  return fromAirtableRecord(createdSession, 'session');
}

async function handleCreateTopic(body) {
  const fields = toAirtableFields(body, 'topic');
  if (!fields.Session) {
    throw new Error('sessionId is required to create a topic');
  }
  const created = await createRecord(env.TOPICS_TABLE_ID, fields);
  return fromAirtableRecord(created, 'topic');
}

async function handleUpdateTopic(topicId, body) {
  if (!topicId) {
    throw new Error('Topic ID is required for update');
  }
  const fields = toAirtableFields(body, 'topic');
  const updated = await updateRecord(env.TOPICS_TABLE_ID, topicId, fields);
  return fromAirtableRecord(updated, 'topic');
}

async function handleCreateComment(body) {
  const fields = toAirtableFields(body, 'comment');
  if (!fields.Topic || !fields.User) {
    throw new Error('topicId and userId are required to create a comment');
  }
  const created = await createRecord(env.COMMENTS_TABLE_ID, fields);
  return fromAirtableRecord(created, 'comment');
}

async function handleCreateUser(body) {
  const { sessionId, sessionIds, ...rest } = body || {};
  const payload = { ...rest };

  if (sessionIds && !Array.isArray(sessionIds)) {
    payload.sessionIds = [sessionIds];
  } else if (sessionIds) {
    payload.sessionIds = sessionIds;
  }

  if (sessionId) {
    payload.sessionIds = Array.isArray(payload.sessionIds)
      ? Array.from(new Set([...payload.sessionIds, sessionId]))
      : [sessionId];
  }

  const fields = toAirtableFields(payload, 'user');
  if (!fields.Name) {
    fields.Name = rest?.name || 'Guest';
  }

  const created = await createRecord(env.USERS_TABLE_ID, fields);
  return fromAirtableRecord(created, 'user');
}

async function fetchVoteLimit(sessionId) {
  const sessionRecord = await getRecord(env.SESSIONS_TABLE_ID, sessionId);
  const boardIdField = sessionRecord.fields?.Board;
  const boardId = Array.isArray(boardIdField) ? boardIdField[0] : boardIdField;
  if (!boardId) {
    return { limit: Infinity, sessionRecord };
  }
  try {
    const boardRecord = await getRecord(env.BOARDS_TABLE_ID, boardId);
    const limit = boardRecord.fields?.VoteLimit;
    return { limit: typeof limit === 'number' ? limit : Infinity, sessionRecord, boardRecord };
  } catch (error) {
    if (error instanceof AirtableApiError && error.statusCode === 404) {
      return { limit: Infinity, sessionRecord };
    }
    throw error;
  }
}

async function handleCreateVote(body) {
  const { sessionId, userId } = body;
  if (!sessionId || !userId) {
    throw new Error('sessionId and userId are required to cast a vote');
  }

  const { limit } = await fetchVoteLimit(sessionId);
  let existingVotes = [];

  if (Number.isFinite(limit)) {
    existingVotes = await listRecords(env.VOTES_TABLE_ID, {
      filterByFormula: `AND(${linkFilter('Session', sessionId)}, ${linkFilter('User', userId)})`,
    });
    if (existingVotes.length >= limit) {
      return {
        error: true,
        response: {
          statusCode: 400,
          body: JSON.stringify({
            error: 'vote_limit_reached',
            message: 'You have used all of your votes for this session.',
          }),
        },
      };
    }
  }

  const fields = toAirtableFields(body, 'vote');
  if (!fields.Topic) {
    throw new Error('topicId is required to cast a vote');
  }
  const created = await createRecord(env.VOTES_TABLE_ID, fields);
  const vote = fromAirtableRecord(created, 'vote');
  const remainingVotes = Number.isFinite(limit)
    ? Math.max(0, limit - (existingVotes.length + 1))
    : Infinity;
  return { vote, remainingVotes };
}

async function handleDeleteVote(voteId) {
  if (!voteId) {
    throw new Error('Vote ID is required to retract a vote');
  }
  const voteRecord = await getRecord(env.VOTES_TABLE_ID, voteId);
  const vote = fromAirtableRecord(voteRecord, 'vote');
  await deleteRecord(env.VOTES_TABLE_ID, voteId);

  let remainingVotes = Infinity;
  if (vote.sessionId && vote.userId) {
    const { limit } = await fetchVoteLimit(vote.sessionId);
    if (Number.isFinite(limit)) {
      const currentVotes = await listRecords(env.VOTES_TABLE_ID, {
        filterByFormula: `AND(${linkFilter('Session', vote.sessionId)}, ${linkFilter('User', vote.userId)})`,
      });
      remainingVotes = Math.max(0, limit - currentVotes.length);
    }
  }

  return { id: voteId, vote, remainingVotes };
}

function notFound() {
  return {
    statusCode: 404,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'Not Found' }),
  };
}

exports.handler = async (event) => {
  try {
    const method = event.httpMethod;
    const path = normalisePath(event);
    const segments = path.split('/').filter(Boolean);
    const [resource, resourceId] = segments;

    switch (resource) {
      case undefined:
      case 'sessions':
        if (method === 'GET') {
          const sessionId = resource === 'sessions' ? resourceId : undefined;
          const data = await loadSession(sessionId, event.queryStringParameters || {});
          if (!data) {
            return {
              statusCode: 404,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ error: 'Session not found' }),
            };
          }
          return ok(data);
        }
        if (method === 'POST') {
          const body = parseBody(event);
          const session = await handleCreateSession(body);
          return ok(session, 201);
        }
        break;
      case 'topics':
        if (method === 'POST') {
          const body = parseBody(event);
          const topic = await handleCreateTopic(body);
          return ok(topic, 201);
        }
        if (method === 'PATCH') {
          const body = parseBody(event);
          const topic = await handleUpdateTopic(resourceId, body);
          return ok(topic);
        }
        break;
      case 'votes':
        if (method === 'POST') {
          const body = parseBody(event);
          const voteResult = await handleCreateVote(body);
          if (voteResult?.error) {
            return {
              statusCode: voteResult.response.statusCode,
              headers: { 'Content-Type': 'application/json' },
              body: voteResult.response.body,
            };
          }
          return ok(voteResult, 201);
        }
        if (method === 'DELETE') {
          const result = await handleDeleteVote(resourceId);
          return ok(result, 200);
        }
        break;
      case 'users':
        if (method === 'POST') {
          const body = parseBody(event);
          const user = await handleCreateUser(body);
          return ok(user, 201);
        }
        break;
      case 'comments':
        if (method === 'POST') {
          const body = parseBody(event);
          const comment = await handleCreateComment(body);
          return ok(comment, 201);
        }
        break;
      default:
        break;
    }

    return notFound();
  } catch (error) {
    return errorResponse(error);
  }
};

exports._normalisePath = normalisePath;
