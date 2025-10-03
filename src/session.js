const {
  getSession,
  createTopic,
  updateTopic,
  createVote,
  deleteVote,
  createUser,
  resolveApiBase,
} = require('./api.js');

const DEFAULT_POLL_INTERVAL = 15000;

const state = {
  board: null,
  session: null,
  topics: [],
  votes: [],
  comments: [],
  users: [],
  currentUser: null,
  remainingVotes: Infinity,
  pollerId: null,
  identity: null,
  sessionLookup: null,
  baseUrl: null,
};

const listeners = new Set();

function determineBaseUrl(baseOption) {
  if (baseOption) {
    return resolveApiBase(baseOption);
  }
  if (state.baseUrl) {
    return state.baseUrl;
  }
  return resolveApiBase('');
}

function cloneTopic(topic) {
  return { ...topic };
}

function cloneVote(vote) {
  return { ...vote };
}

function cloneComment(comment) {
  return { ...comment };
}

function cloneUser(user) {
  return { ...user };
}

function snapshot() {
  return {
    board: state.board ? { ...state.board } : null,
    session: state.session ? { ...state.session } : null,
    topics: state.topics.map(cloneTopic),
    votes: state.votes.map(cloneVote),
    comments: state.comments.map(cloneComment),
    users: state.users.map(cloneUser),
    currentUser: state.currentUser ? { ...state.currentUser } : null,
    remainingVotes: state.remainingVotes,
    baseUrl: state.baseUrl,
  };
}

function notify() {
  const currentSnapshot = snapshot();
  for (const listener of listeners) {
    try {
      listener(currentSnapshot);
    } catch (error) {
      console.error('LeanCoffee listener error', error); // eslint-disable-line no-console
    }
  }
}

function storageKey(sessionId) {
  return `leancoffee:user:${sessionId}`;
}

function getSessionStorage(customStorage) {
  if (customStorage) {
    return customStorage;
  }
  if (typeof window !== 'undefined' && window.sessionStorage) {
    return window.sessionStorage;
  }
  return null;
}

function readCookie(key) {
  if (typeof document === 'undefined') return null;
  const cookies = document.cookie ? document.cookie.split(';') : [];
  for (const cookie of cookies) {
    const [cookieKey, ...rest] = cookie.trim().split('=');
    if (cookieKey === key) {
      return decodeURIComponent(rest.join('='));
    }
  }
  return null;
}

function writeCookie(key, value) {
  if (typeof document === 'undefined') return;
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `${key}=${encodeURIComponent(value)}; path=/; expires=${expires}`;
}

function readIdentity(sessionId, customStorage) {
  const key = storageKey(sessionId);
  const storage = getSessionStorage(customStorage);
  let raw = null;
  if (storage) {
    try {
      raw = storage.getItem(key);
    } catch (error) {
      raw = null;
    }
  }
  if (!raw) {
    raw = readCookie(key);
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function writeIdentity(sessionId, identity, customStorage) {
  const key = storageKey(sessionId);
  const payload = JSON.stringify(identity);
  const storage = getSessionStorage(customStorage);
  if (storage) {
    try {
      storage.setItem(key, payload);
    } catch (error) {
      // Ignore storage failures
    }
  }
  writeCookie(key, payload);
}

function generateExternalId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `lc-${Math.random().toString(36).slice(2, 10)}${Date.now()}`;
}

function ensureIdentity(sessionId, customStorage, existingIdentity) {
  let identity = existingIdentity || readIdentity(sessionId, customStorage) || null;
  if (!identity || !identity.externalId) {
    identity = { externalId: generateExternalId() };
  }
  return identity;
}

function computeRemainingVotes(voteLimit, votes, userId) {
  if (!Number.isFinite(voteLimit)) {
    return Infinity;
  }
  if (!userId) {
    return voteLimit;
  }
  const used = votes.filter((vote) => vote.userId === userId).length;
  return Math.max(0, voteLimit - used);
}

function updateRemainingVotesFromResponse(response) {
  if (!response) return;
  const remaining = response.remainingVotes;
  if (remaining === undefined || remaining === null) {
    return;
  }
  if (Number.isFinite(remaining)) {
    state.remainingVotes = remaining;
  } else {
    state.remainingVotes = Infinity;
  }
}

function findUserByIdentity(users, identity) {
  if (!identity) return null;
  if (identity.userId) {
    const byId = users.find((user) => user.id === identity.userId);
    if (byId) return byId;
  }
  if (identity.externalId) {
    return users.find((user) => user.externalId === identity.externalId) || null;
  }
  return null;
}

async function ensureUserForIdentity(sessionData, baseUrl, identity, customStorage, profile) {
  let user = findUserByIdentity(sessionData.users || [], identity);
  if (user) {
    if (identity && user.id && identity.userId !== user.id) {
      identity.userId = user.id;
      writeIdentity(sessionData.session.id, identity, customStorage);
    }
    return user;
  }

  const payload = {
    name: profile?.name || 'Guest',
    externalId: identity.externalId,
    sessionId: sessionData.session.id,
  };
  if (profile?.email) {
    payload.email = profile.email;
  }
  if (profile?.avatar) {
    payload.avatar = profile.avatar;
  }

  const created = await createUser(payload, { baseUrl });
  sessionData.users = [...(sessionData.users || []), created];
  identity.userId = created.id;
  writeIdentity(sessionData.session.id, identity, customStorage);
  return created;
}

function setStateFromSession(sessionData, identity, baseUrl) {
  const { board, session, topics, votes, comments, users } = sessionData;
  state.board = board ? { ...board } : null;
  state.session = session ? { ...session } : null;
  state.topics = Array.isArray(topics) ? topics.map(cloneTopic) : [];
  state.votes = Array.isArray(votes) ? votes.map(cloneVote) : [];
  state.comments = Array.isArray(comments) ? comments.map(cloneComment) : [];
  state.users = Array.isArray(users) ? users.map(cloneUser) : [];
  state.baseUrl = baseUrl ?? state.baseUrl;
  state.identity = identity || state.identity;
  if (state.currentUser) {
    const refreshedUser = findUserByIdentity(state.users, state.identity || identity);
    state.currentUser = refreshedUser ? { ...refreshedUser } : null;
  }
  if (!state.currentUser && identity) {
    const fallback = findUserByIdentity(state.users, identity);
    state.currentUser = fallback ? { ...fallback } : null;
  }
  const voteLimit = state.board?.voteLimit;
  state.remainingVotes = computeRemainingVotes(voteLimit, state.votes, state.currentUser?.id);
}

function ensureSessionLookup(requested, resolvedSession) {
  const lookup = { ...(state.sessionLookup || {}) };
  if (requested?.sessionId) {
    lookup.sessionId = requested.sessionId;
  }
  if (requested?.code) {
    lookup.code = requested.code;
  }
  if (resolvedSession?.id) {
    lookup.sessionId = resolvedSession.id;
  }
  if (resolvedSession?.code) {
    lookup.code = resolvedSession.code;
  }
  state.sessionLookup = lookup.sessionId || lookup.code ? lookup : null;
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return snapshot();
}

async function bootstrapSession(options = {}) {
  const { sessionId, code, baseUrl, storage, profile } = options;
  const apiBase = determineBaseUrl(baseUrl);
  const requestLookup = sessionId
    ? { sessionId }
    : code
    ? { code }
    : state.sessionLookup;
  if (!requestLookup || (!requestLookup.sessionId && !requestLookup.code)) {
    throw new Error('A session identifier or code is required to bootstrap');
  }
  const sessionData = await getSession(requestLookup, { baseUrl: apiBase });
  const sessionIdentifier = sessionData?.session?.id;
  if (!sessionIdentifier) {
    throw new Error('Session data is missing required session id');
  }

  const identity = ensureIdentity(sessionIdentifier, storage, state.identity);
  const user = await ensureUserForIdentity(sessionData, apiBase, identity, storage, profile);

  state.currentUser = user ? { ...user } : null;
  setStateFromSession(sessionData, identity, apiBase);
  ensureSessionLookup({ sessionId, code }, sessionData.session);
  writeIdentity(sessionIdentifier, identity, storage);
  notify();
  return snapshot();
}

function findTopicIndex(topicId) {
  return state.topics.findIndex((topic) => topic.id === topicId);
}

async function applyTopicPatch(topicId, changes, baseUrl) {
  const index = findTopicIndex(topicId);
  if (index === -1) {
    throw new Error(`Topic ${topicId} not found`);
  }

  const previousTopics = state.topics.map(cloneTopic);
  const optimisticTopics = previousTopics.map((topic) =>
    topic.id === topicId ? { ...topic, ...changes } : topic,
  );
  state.topics = optimisticTopics;
  notify();

  try {
    const updated = await updateTopic(topicId, changes, { baseUrl });
    const mergedTopics = optimisticTopics.map((topic) =>
      topic.id === topicId ? { ...topic, ...updated } : topic,
    );
    state.topics = mergedTopics;
    notify();
    return mergedTopics[index];
  } catch (error) {
    state.topics = previousTopics;
    notify();
    throw error;
  }
}

async function handleTopicSubmit({ title, description, status, order } = {}, options = {}) {
  if (!state.session) {
    throw new Error('Cannot create topic without an active session');
  }

  const base = determineBaseUrl(options.baseUrl);
  const payload = {
    sessionId: state.session.id,
    boardId: state.board?.id || undefined,
    title: title?.trim() || '',
    description: description?.trim() || '',
    status: status || undefined,
    order: order ?? undefined,
  };
  if (state.currentUser?.id) {
    payload.authorId = state.currentUser.id;
  }

  const topic = await createTopic(payload, { baseUrl: base });
  state.topics = [...state.topics, topic];
  notify();
  return topic;
}

async function toggleVote(topicId, options = {}) {
  if (!state.session || !state.currentUser) {
    throw new Error('Voting requires an active session and user');
  }
  const base = determineBaseUrl(options.baseUrl);
  const existingVote = state.votes.find(
    (vote) => vote.topicId === topicId && vote.userId === state.currentUser.id,
  );

  if (existingVote) {
    const response = await deleteVote(existingVote.id, { baseUrl: base });
    state.votes = state.votes.filter((vote) => vote.id !== existingVote.id);
    updateRemainingVotesFromResponse(response);
    notify();
    return response;
  }

  const response = await createVote(
    {
      sessionId: state.session.id,
      topicId,
      userId: state.currentUser.id,
      weight: 1,
    },
    { baseUrl: base },
  );
  const createdVote = response?.vote || response;
  state.votes = [...state.votes, createdVote];
  updateRemainingVotesFromResponse(response);
  notify();
  return response;
}

function promoteToDiscussing(topicId, options = {}) {
  const base = determineBaseUrl(options.baseUrl);
  return applyTopicPatch(topicId, { status: 'discussing' }, base);
}

function moveToStatus(topicId, status, options = {}) {
  if (!status) {
    throw new Error('status is required to move a topic');
  }
  const base = determineBaseUrl(options.baseUrl);
  return applyTopicPatch(topicId, { status }, base);
}

function completeTopic(topicId, options = {}) {
  const base = determineBaseUrl(options.baseUrl);
  return applyTopicPatch(topicId, { status: 'completed' }, base);
}

function saveTopicNotes(topicId, notes, options = {}) {
  const base = determineBaseUrl(options.baseUrl);
  return applyTopicPatch(topicId, { notes }, base);
}

async function refreshSessionData(options = {}) {
  const lookup = state.sessionLookup;
  if (!lookup) {
    throw new Error('No session lookup information available for refresh');
  }
  const base = determineBaseUrl(options.baseUrl);
  const sessionData = await getSession(lookup, { baseUrl: base });
  const sessionId = sessionData?.session?.id;
  if (!sessionId) {
    throw new Error('Refresh failed: session id missing in response');
  }

  const identity = ensureIdentity(sessionId, options.storage, state.identity);
  let user = findUserByIdentity(sessionData.users || [], identity);
  if (!user && identity?.externalId) {
    user = await ensureUserForIdentity(sessionData, base, identity, options.storage, options.profile);
  }
  state.currentUser = user ? { ...user } : state.currentUser;
  setStateFromSession(sessionData, identity, base);
  ensureSessionLookup(lookup, sessionData.session);
  writeIdentity(sessionId, identity, options.storage);
  notify();
  return snapshot();
}

function startPolling(interval = DEFAULT_POLL_INTERVAL, options = {}) {
  stopPolling();
  const delay = Number.isFinite(interval) && interval > 0 ? interval : DEFAULT_POLL_INTERVAL;
  state.pollerId = setInterval(() => {
    refreshSessionData(options).catch((error) => {
      console.error('Failed to refresh LeanCoffee session', error); // eslint-disable-line no-console
    });
  }, delay);
  return () => stopPolling();
}

function stopPolling() {
  if (state.pollerId) {
    clearInterval(state.pollerId);
    state.pollerId = null;
  }
}

function buildExportPayload(data) {
  return {
    generatedAt: new Date().toISOString(),
    board: data.board,
    session: data.session,
    topics: data.topics,
    votes: data.votes,
    comments: data.comments,
    users: data.users,
  };
}

async function exportSession(options = {}) {
  const { fresh = false } = options;
  if (fresh || !state.session) {
    const refreshed = await refreshSessionData(options);
    return buildExportPayload(refreshed);
  }
  return buildExportPayload(snapshot());
}

function getCurrentUser() {
  return state.currentUser ? { ...state.currentUser } : null;
}

function getRemainingVotes() {
  return state.remainingVotes;
}

function getIdentity() {
  return state.identity ? { ...state.identity } : null;
}

module.exports = {
  subscribe,
  getSnapshot,
  bootstrapSession,
  handleTopicSubmit,
  toggleVote,
  promoteToDiscussing,
  moveToStatus,
  completeTopic,
  saveTopicNotes,
  refreshSessionData,
  startPolling,
  stopPolling,
  exportSession,
  getCurrentUser,
  getRemainingVotes,
  getIdentity,
};
