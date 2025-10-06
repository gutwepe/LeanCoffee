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

for (const key of requiredEnv) {
  if (!process.env[key]) {
    process.env[key] = 'test';
  }
}

const { _normalisePath } = require('../netlify/functions/airtable');

test('handles matches missing an index property', () => {
  const originalMatch = String.prototype.match;
  try {
    String.prototype.match = function patchedMatch(regex) {
      const result = originalMatch.call(this, regex);
      if (!result) {
        return result;
      }
      const clone = Array.from(result);
      clone.input = result.input;
      clone.groups = result.groups;
      return clone;
    };
    const normalised = _normalisePath({ path: '/.netlify/functions/airtable/sessions' });
    assert.equal(normalised, '/sessions');
  } finally {
    String.prototype.match = originalMatch;
  }
});

test('prefers non-empty matches when multiple candidates exist', () => {
  assert.equal(
    _normalisePath({
      path: '/.netlify/functions/airtable',
      rawUrl: 'https://example.com/.netlify/functions/airtable/topics?foo=bar',
    }),
    '/topics'
  );
});

test('falls back to Netlify original path headers', () => {
  assert.equal(
    _normalisePath({
      path: '/.netlify/functions/airtable',
      headers: {
        'x-nf-original-pathname': '/.netlify/functions/airtable/votes#hash',
      },
    }),
    '/votes'
  );
});

test('decodes percent-encoded path segments', () => {
  assert.equal(
    _normalisePath({
      rawUrl: 'https://example.com/.netlify/functions/airtable%2Fsessions%2Fabc',
    }),
    '/sessions/abc'
  );

  assert.equal(
    _normalisePath({
      rawPath: '/.netlify/functions/airtable/%2Ftopics%2Fxyz',
    }),
    '/topics/xyz'
  );
});

test('returns an empty string when only the root function path matches', () => {
  assert.equal(_normalisePath({ path: '/.netlify/functions/airtable' }), '');
});

test('returns the first candidate when nothing matches', () => {
  assert.equal(_normalisePath({ path: '/api/airtable' }), '/api/airtable');
});
