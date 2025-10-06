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

const assert = require('node:assert/strict');
const { _normalisePath } = require('../netlify/functions/airtable');

if (typeof _normalisePath !== 'function') {
  throw new Error('normalisePath export missing');
}

const originalMatch = String.prototype.match;
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

try {
  const normalised = _normalisePath({ path: '/.netlify/functions/airtable/sessions' });
  assert.strictEqual(normalised, '/sessions');
  console.log('normalisePath without match index ->', normalised);
} finally {
  String.prototype.match = originalMatch;
}

assert.strictEqual(_normalisePath({ path: '/.netlify/functions/airtable' }), '');
assert.strictEqual(_normalisePath({ path: '/.netlify/functions/airtable?foo=bar' }), '');
assert.strictEqual(_normalisePath({ path: '/.netlify/functions/airtable#fragment' }), '');
assert.strictEqual(
  _normalisePath({ path: '/.netlify/functions/airtable/topics?foo=bar' }),
  '/topics'
);
assert.strictEqual(
  _normalisePath({
    path: '',
    rawUrl: 'https://example.com/.netlify/functions/airtable/sessions?foo=bar',
  }),
  '/sessions'
);
console.log('Additional normalisePath assertions passed');
