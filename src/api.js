const DEFAULT_FUNCTION_BASE = '/.netlify/functions/airtable';

function resolveBaseUrl(baseUrl) {
  if (baseUrl) {
    if (/^https?:\/\//i.test(baseUrl)) {
      return baseUrl.replace(/\/$/, '');
    }
    if (typeof window !== 'undefined' && window.location) {
      return new URL(baseUrl, window.location.origin).toString().replace(/\/$/, '');
    }
  }

  if (typeof window !== 'undefined' && window.location) {
    return `${window.location.origin}${DEFAULT_FUNCTION_BASE}`;
  }

  return `http://localhost:8888${DEFAULT_FUNCTION_BASE}`;
}

function buildUrl(baseUrl, path, query) {
  const normalisedBase = resolveBaseUrl(baseUrl);
  const normalisedPath = path.replace(/^\/+/, '');
  const url = new URL(normalisedPath, `${normalisedBase}/`);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          url.searchParams.append(key, item);
        }
      } else {
        url.searchParams.append(key, value);
      }
    }
  }

  return url.toString();
}

async function parseJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    return { message: text };
  }
}

class ApiError extends Error {
  constructor(message, response, payload) {
    super(message);
    this.name = 'ApiError';
    this.status = response?.status;
    this.payload = payload;
  }
}

async function apiRequest(method, path, { query, body, baseUrl } = {}) {
  const url = buildUrl(baseUrl, path, query);
  const headers = { Accept: 'application/json' };
  const init = { method, headers };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  const response = await fetch(url, init);
  if (!response.ok) {
    const payload = await parseJson(response);
    throw new ApiError(payload?.error || payload?.message || response.statusText, response, payload);
  }

  if (response.status === 204) {
    return null;
  }

  return parseJson(response);
}

async function getSession({ sessionId, code } = {}, options = {}) {
  if (sessionId) {
    return apiRequest('GET', `/sessions/${sessionId}`, { baseUrl: options.baseUrl });
  }
  return apiRequest('GET', '/sessions', {
    baseUrl: options.baseUrl,
    query: code ? { code } : undefined,
  });
}

async function createTopic(data, options = {}) {
  return apiRequest('POST', '/topics', { baseUrl: options.baseUrl, body: data });
}

async function updateTopic(topicId, data, options = {}) {
  if (!topicId) {
    throw new Error('topicId is required to update a topic');
  }
  return apiRequest('PATCH', `/topics/${topicId}`, { baseUrl: options.baseUrl, body: data });
}

async function createVote(data, options = {}) {
  return apiRequest('POST', '/votes', { baseUrl: options.baseUrl, body: data });
}

async function deleteVote(voteId, options = {}) {
  if (!voteId) {
    throw new Error('voteId is required to delete a vote');
  }
  return apiRequest('DELETE', `/votes/${voteId}`, { baseUrl: options.baseUrl });
}

async function createUser(data, options = {}) {
  return apiRequest('POST', '/users', { baseUrl: options.baseUrl, body: data });
}

async function createComment(data, options = {}) {
  return apiRequest('POST', '/comments', { baseUrl: options.baseUrl, body: data });
}

function resolveApiBase(baseUrl) {
  return resolveBaseUrl(baseUrl);
}

module.exports = {
  ApiError,
  apiRequest,
  getSession,
  createTopic,
  updateTopic,
  createVote,
  deleteVote,
  createUser,
  createComment,
  resolveApiBase,
  resolveBaseUrl,
};
