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
