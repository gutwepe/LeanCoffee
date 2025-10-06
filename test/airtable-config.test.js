const test = require('node:test');
const assert = require('node:assert/strict');

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

function withRequiredEnv(fn) {
  const previous = {};
  for (const key of requiredEnv) {
    previous[key] = process.env[key];
    if (!process.env[key]) {
      process.env[key] = 'test';
    }
  }
  try {
    return fn();
  } finally {
    for (const key of requiredEnv) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  }
}

async function withRequiredEnvAsync(fn) {
  const previous = {};
  for (const key of requiredEnv) {
    previous[key] = process.env[key];
    if (!process.env[key]) {
      process.env[key] = 'test';
    }
  }
  try {
    return await fn();
  } finally {
    for (const key of requiredEnv) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  }
}

function freshModule() {
  const modulePath = require.resolve('../netlify/functions/airtable');
  delete require.cache[modulePath];
  return require(modulePath);
}

test('defaults to the Airtable API base domain', () => {
  withRequiredEnv(() => {
    const previousBase = process.env.AIRTABLE_API_BASE_URL;
    delete process.env.AIRTABLE_API_BASE_URL;
    const modulePath = require.resolve('../netlify/functions/airtable');
    const { AIRTABLE_API_BASE } = freshModule();
    assert.equal(AIRTABLE_API_BASE, 'https://api.airtable.com/v0');
    delete require.cache[modulePath];
    if (previousBase === undefined) {
      delete process.env.AIRTABLE_API_BASE_URL;
    } else {
      process.env.AIRTABLE_API_BASE_URL = previousBase;
    }
  });
});

test('allows overriding the Airtable API base domain for testing', () => {
  withRequiredEnv(() => {
    const previousBase = process.env.AIRTABLE_API_BASE_URL;
    process.env.AIRTABLE_API_BASE_URL = 'https://example.test';
    const modulePath = require.resolve('../netlify/functions/airtable');
    const { AIRTABLE_API_BASE } = freshModule();
    assert.equal(AIRTABLE_API_BASE, 'https://example.test');
    delete require.cache[modulePath];
    if (previousBase === undefined) {
      delete process.env.AIRTABLE_API_BASE_URL;
    } else {
      process.env.AIRTABLE_API_BASE_URL = previousBase;
    }
  });
});

test('PATCH /boards/:id updates theme metadata', async () => {
  await withRequiredEnvAsync(async () => {
    const originalFetch = global.fetch;
    const fetchCalls = [];
    global.fetch = async (url, options) => {
      fetchCalls.push({ url, options });
      return {
        status: 200,
        ok: true,
        headers: { get: () => null },
        text: async () =>
          JSON.stringify({
            id: 'recBoard',
            fields: {
              ThemeMode: 'dark',
              AccentColor: '#ff00ff',
              Announcement: 'Hello world',
            },
          }),
      };
    };

    try {
      const { handler } = freshModule();
      const response = await handler({
        httpMethod: 'PATCH',
        path: '/.netlify/functions/airtable/boards/recBoard',
        body: JSON.stringify({
          themeMode: 'dark',
          accentColor: '#ff00ff',
          announcement: 'Hello world',
        }),
      });

      assert.equal(fetchCalls.length, 1);
      const [{ options }] = fetchCalls;
      assert.equal(options.method, 'PATCH');
      const parsedBody = JSON.parse(options.body);
      assert.deepEqual(parsedBody, {
        fields: {
          ThemeMode: 'dark',
          AccentColor: '#ff00ff',
          Announcement: 'Hello world',
        },
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.id, 'recBoard');
      assert.equal(body.themeMode, 'dark');
      assert.equal(body.accentColor, '#ff00ff');
      assert.equal(body.announcement, 'Hello world');
      assert.deepEqual(body.raw, {
        ThemeMode: 'dark',
        AccentColor: '#ff00ff',
        Announcement: 'Hello world',
      });
    } finally {
      global.fetch = originalFetch;
    }
  });
});
