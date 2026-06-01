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

function readBodyBuffer(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function sendHtml(response, statusCode, html) {
  response.writeHead(statusCode, {
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
  escapeHtml,
  parseUrlEncoded,
  readBody,
  readBodyBuffer,
  sendHtml,
  redirect,
  notFound,
  methodNotAllowed,
};
