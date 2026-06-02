const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
].join('; ');

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function parseUrlEncoded(body) {
  const params = new URLSearchParams(body || '');
  const data = {};

  for (const [key, value] of params.entries()) {
    if (Object.hasOwn(data, key)) {
      data[key] = Array.isArray(data[key]) ? [...data[key], value] : [data[key], value];
    } else {
      data[key] = value;
    }
  }

  return data;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function bodyTooLargeError(maxBytes) {
  const error = new Error(`Request body is too large. Maximum allowed size is ${maxBytes} bytes.`);
  error.statusCode = 413;
  return error;
}

function readBodyBuffer(request, options = {}) {
  const maxBytes = Number.isFinite(options.maxBytes) && options.maxBytes > 0
    ? options.maxBytes
    : null;

  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let rejected = false;

    const contentLength = Number(request.headers?.['content-length']);
    if (maxBytes && Number.isFinite(contentLength) && contentLength > maxBytes) {
      reject(bodyTooLargeError(maxBytes));
      return;
    }

    request.on('data', (chunk) => {
      if (rejected) return;
      totalBytes += chunk.length;
      if (maxBytes && totalBytes > maxBytes) {
        rejected = true;
        reject(bodyTooLargeError(maxBytes));
        if (typeof request.destroy === 'function') request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', (error) => {
      if (!rejected) reject(error);
    });
  });
}

function sendHtml(response, statusCode, html) {
  response.writeHead(statusCode, {
    'content-security-policy': CONTENT_SECURITY_POLICY,
    'content-type': 'text/html; charset=utf-8',
  });
  response.end(html);
}

function redirect(response, location, statusCode = 303) {
  response.writeHead(statusCode, {
    location,
  });
  response.end('');
}

function notFound(response) {
  sendHtml(response, 404, '<!doctype html><title>Not Found</title><h1>Not Found</h1>');
}

function methodNotAllowed(response, allowedMethods) {
  response.writeHead(405, {
    allow: allowedMethods.join(', '),
    'content-type': 'text/plain; charset=utf-8',
  });
  response.end('Method Not Allowed');
}

module.exports = {
  CONTENT_SECURITY_POLICY,
  escapeHtml,
  parseUrlEncoded,
  readBody,
  readBodyBuffer,
  sendHtml,
  redirect,
  notFound,
  methodNotAllowed,
};
