const crypto = require('node:crypto');

const SCRYPT_PARAMS = {
  N: 16384,
  r: 8,
  p: 1,
  keylen: 64,
};

const SCRYPT_PARAM_STRING = `N=${SCRYPT_PARAMS.N},r=${SCRYPT_PARAMS.r},p=${SCRYPT_PARAMS.p},keylen=${SCRYPT_PARAMS.keylen}`;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const key = crypto
    .scryptSync(password, salt, SCRYPT_PARAMS.keylen, {
      N: SCRYPT_PARAMS.N,
      r: SCRYPT_PARAMS.r,
      p: SCRYPT_PARAMS.p,
    })
    .toString('base64url');

  return `scrypt:v1:${SCRYPT_PARAM_STRING}:${salt}:${key}`;
}

function parseScryptHash(encoded) {
  if (typeof encoded !== 'string') return null;

  const parts = encoded.split(':');
  if (parts.length !== 5) return null;

  const [algorithm, version, paramString, salt, hash] = parts;
  if (algorithm !== 'scrypt' || version !== 'v1' || paramString !== SCRYPT_PARAM_STRING) {
    return null;
  }

  const hashBuffer = Buffer.from(hash, 'base64url');
  if (hashBuffer.length !== SCRYPT_PARAMS.keylen || salt === '') return null;

  return { salt, hashBuffer };
}

function verifyPassword(password, encoded) {
  const parsed = parseScryptHash(encoded);
  if (!parsed) return false;

  const candidate = crypto.scryptSync(password, parsed.salt, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
  });

  return crypto.timingSafeEqual(candidate, parsed.hashBuffer);
}

module.exports = {
  hashPassword,
  verifyPassword,
};
