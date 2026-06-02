const { readBodyBuffer } = require('./httpUtils');
const { DEFAULT_MAX_BYTES } = require('./uploads');

const MULTIPART_FIELD_OVERHEAD_BYTES = 128 * 1024;
const MAX_MULTIPART_BODY_BYTES = DEFAULT_MAX_BYTES + MULTIPART_FIELD_OVERHEAD_BYTES;

function parseContentDisposition(value) {
  const params = {};
  for (const segment of String(value || '')
    .split(';')
    .slice(1)) {
    const index = segment.indexOf('=');
    if (index === -1) continue;

    const key = segment.slice(0, index).trim().toLowerCase();
    let paramValue = segment.slice(index + 1).trim();
    if (paramValue.startsWith('"') && paramValue.endsWith('"')) {
      paramValue = paramValue.slice(1, -1);
    }
    params[key] = paramValue;
  }
  return params;
}

function getMultipartBoundary(contentType) {
  const match = String(contentType || '').match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  return match ? (match[1] || match[2]).trim() : '';
}

async function readMultipartForm(request) {
  const contentType = String(request.headers['content-type'] || '');
  const boundary = getMultipartBoundary(contentType);
  if (!boundary) {
    const error = new Error('Multipart form boundary is required.');
    error.statusCode = 400;
    throw error;
  }

  const raw = (await readBodyBuffer(request, { maxBytes: MAX_MULTIPART_BODY_BYTES })).toString(
    'latin1',
  );
  const parts = raw.split(`--${boundary}`);
  const fields = {};
  const files = {};

  for (const rawPart of parts) {
    if (!rawPart || rawPart === '--\r\n' || rawPart === '--') continue;

    const part = rawPart
      .replace(/^\r\n/, '')
      .replace(/\r\n--$/, '')
      .replace(/\r\n$/, '');
    const separator = part.indexOf('\r\n\r\n');
    if (separator === -1) continue;

    const rawHeaders = part.slice(0, separator);
    const rawBody = part.slice(separator + 4);
    const headers = {};
    for (const line of rawHeaders.split('\r\n')) {
      const index = line.indexOf(':');
      if (index === -1) continue;
      headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
    }

    const disposition = parseContentDisposition(headers['content-disposition']);
    const name = disposition.name;
    if (!name) continue;

    const body = Buffer.from(rawBody, 'latin1');
    if (Object.hasOwn(disposition, 'filename')) {
      if (!disposition.filename) continue;
      files[name] = {
        originalFilename: disposition.filename,
        contentType: headers['content-type'] || 'application/octet-stream',
        buffer: body,
      };
    } else {
      fields[name] = body.toString('utf8');
    }
  }

  return { fields, files };
}

module.exports = {
  readMultipartForm,
};
