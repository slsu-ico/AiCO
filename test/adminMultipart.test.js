const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const test = require('node:test');

const { readMultipartForm } = require('../src/adminMultipart');

function multipartRequest(parts, boundary = '----aico-test-boundary') {
  const chunks = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if (part.filename) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n` +
            `Content-Type: ${part.contentType || 'application/octet-stream'}\r\n\r\n`,
        ),
      );
      chunks.push(Buffer.isBuffer(part.value) ? part.value : Buffer.from(String(part.value)));
      chunks.push(Buffer.from('\r\n'));
    } else {
      chunks.push(
        Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`),
      );
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  const request = Readable.from(Buffer.concat(chunks));
  request.headers = {
    'content-type': `multipart/form-data; boundary=${boundary}`,
  };
  return request;
}

test('readMultipartForm parses fields and files from a multipart request', async () => {
  const request = multipartRequest([
    { name: 'title', value: 'Certification Request' },
    {
      name: 'attachment',
      filename: 'charter.pdf',
      contentType: 'application/pdf',
      value: Buffer.from('%PDF-1.4'),
    },
  ]);

  const form = await readMultipartForm(request);

  assert.equal(form.fields.title, 'Certification Request');
  assert.equal(form.files.attachment.originalFilename, 'charter.pdf');
  assert.equal(form.files.attachment.contentType, 'application/pdf');
  assert.equal(form.files.attachment.buffer.toString('utf8'), '%PDF-1.4');
});
