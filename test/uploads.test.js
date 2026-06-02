const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { isSafeStoragePath, saveUploadedFile, sanitizeOriginalFilename } = require('../src/uploads');

async function tempUploadDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'aico-uploads-'));
}

test('saveUploadedFile sanitizes the filename and writes inside uploadDir', async () => {
  const uploadDir = await tempUploadDir();

  const result = await saveUploadedFile({
    uploadDir,
    originalFilename: '../unsafe path/Board Resolution Final.pdf',
    contentType: 'application/pdf',
    buffer: Buffer.from('PDF content'),
  });

  const resolvedUploadDir = path.resolve(uploadDir);
  const resolvedStoragePath = path.resolve(result.storagePath);
  const basename = path.basename(result.storagePath);

  assert.equal(result.originalFilename, 'Board Resolution Final.pdf');
  assert.equal(result.fileType, 'application/pdf');
  assert.equal(result.fileSize, Buffer.byteLength('PDF content'));
  assert.equal(path.dirname(resolvedStoragePath), resolvedUploadDir);
  assert.match(basename, /^[0-9a-f-]+-board-resolution-final\.pdf$/);
  assert.equal(basename.includes('..'), false);
  assert.equal(basename.includes('/'), false);
  assert.equal(basename.includes('\\'), false);
  assert.equal(await fs.readFile(result.storagePath, 'utf8'), 'PDF content');
});

test('sanitizeOriginalFilename returns basename without control characters', () => {
  assert.equal(
    sanitizeOriginalFilename('..\\unsafe\u0000 path\\Board\nResolution.pdf'),
    'BoardResolution.pdf',
  );
  assert.equal(sanitizeOriginalFilename('\u0000\u001f'), 'attachment');
});

test('isSafeStoragePath rejects absolute and traversal paths', () => {
  assert.equal(isSafeStoragePath('uploads/123-board-resolution-final.pdf'), true);
  assert.equal(isSafeStoragePath('123-board-resolution-final.pdf'), true);
  assert.equal(isSafeStoragePath('uploads/../secrets.txt'), false);
  assert.equal(isSafeStoragePath('../uploads/secrets.txt'), false);
  assert.equal(isSafeStoragePath(path.resolve('uploads', 'secrets.txt')), false);
});

test('saveUploadedFile rejects files larger than maxBytes', async () => {
  const uploadDir = await tempUploadDir();

  await assert.rejects(
    saveUploadedFile({
      uploadDir,
      originalFilename: 'large.pdf',
      contentType: 'application/pdf',
      buffer: Buffer.alloc(4),
      maxBytes: 3,
    }),
    /File exceeds the maximum allowed size/,
  );
});

test('saveUploadedFile rejects unsupported content types', async () => {
  const uploadDir = await tempUploadDir();

  await assert.rejects(
    saveUploadedFile({
      uploadDir,
      originalFilename: 'script.js',
      contentType: 'application/javascript',
      buffer: Buffer.from('alert(1)'),
    }),
    /Unsupported file type/,
  );
});
