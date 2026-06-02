const assert = require('node:assert/strict');
const test = require('node:test');

const { hashPassword, verifyPassword } = require('../src/passwordHash');

test('hashPassword returns a versioned scrypt hash with embedded parameters', () => {
  const encoded = hashPassword('Secret123!');

  assert.match(encoded, /^scrypt:v1:N=16384,r=8,p=1,keylen=64:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
  assert.notEqual(encoded, 'Secret123!');
});

test('verifyPassword accepts matching versioned scrypt hashes and rejects wrong passwords', () => {
  const encoded = hashPassword('Secret123!');

  assert.equal(verifyPassword('Secret123!', encoded), true);
  assert.equal(verifyPassword('WrongSecret!', encoded), false);
});

test('verifyPassword rejects unsupported or malformed hashes', () => {
  assert.equal(verifyPassword('Secret123!', 'scrypt$opaque$salt'), false);
  assert.equal(
    verifyPassword('Secret123!', 'scrypt:v2:N=16384,r=8,p=1,keylen=64:salt:hash'),
    false,
  );
  assert.equal(verifyPassword('Secret123!', 'not-a-hash'), false);
});
