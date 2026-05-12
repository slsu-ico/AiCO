const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Map([
  ['application/pdf', '.pdf'],
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
]);

function normalizeContentType(contentType) {
  return String(contentType ?? '').split(';', 1)[0].trim().toLowerCase();
}

function isAllowedFileType(contentType) {
  return ALLOWED_TYPES.has(normalizeContentType(contentType));
}

function uploadError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function sanitizeOriginalFilename(originalFilename) {
  const raw = String(originalFilename ?? '').trim();
  const filename = raw.replaceAll('\\', '/').split('/').pop() || 'attachment';
  const sanitized = filename.replace(/[\x00-\x1f\x7f]/g, '').trim();
  return sanitized || 'attachment';
}

function sanitizeStem(filename) {
  const parsed = path.parse(filename);
  const stem = parsed.name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return stem || 'attachment';
}

function ensureInsideUploadDir(uploadDir, storagePath) {
  const resolvedUploadDir = path.resolve(uploadDir);
  const resolvedStoragePath = path.resolve(storagePath);

  if (
    resolvedStoragePath !== resolvedUploadDir
    && !resolvedStoragePath.startsWith(`${resolvedUploadDir}${path.sep}`)
  ) {
    throw uploadError('Invalid upload storage path.');
  }
}

function isSafeStoragePath(storagePath, uploadDir = 'uploads') {
  const raw = String(storagePath ?? '').trim();
  if (!raw || /[\x00-\x1f\x7f]/.test(raw) || path.isAbsolute(raw)) {
    return false;
  }

  const normalizedStoragePath = path.normalize(raw);
  if (normalizedStoragePath === '..' || normalizedStoragePath.startsWith(`..${path.sep}`)) {
    return false;
  }

  const normalizedUploadDir = path.normalize(uploadDir);
  const resolvedUploadDir = path.resolve(normalizedUploadDir);
  const resolvedStoragePath = raw.replaceAll('\\', '/').startsWith(`${uploadDir.replaceAll('\\', '/')}/`)
    ? path.resolve(normalizedStoragePath)
    : path.resolve(normalizedUploadDir, normalizedStoragePath);

  return (
    resolvedStoragePath !== resolvedUploadDir
    && resolvedStoragePath.startsWith(`${resolvedUploadDir}${path.sep}`)
  );
}

async function saveUploadedFile({
  uploadDir,
  originalFilename,
  contentType,
  buffer,
  maxBytes = DEFAULT_MAX_BYTES,
}) {
  if (!uploadDir) {
    throw uploadError('Upload directory is required.');
  }

  if (!Buffer.isBuffer(buffer)) {
    throw uploadError('Upload buffer is required.');
  }

  if (buffer.length > maxBytes) {
    throw uploadError('File exceeds the maximum allowed size.');
  }

  const fileType = normalizeContentType(contentType);
  const extension = ALLOWED_TYPES.get(fileType);
  if (!extension) {
    throw uploadError('Unsupported file type.');
  }

  const safeName = sanitizeOriginalFilename(originalFilename);
  const stem = sanitizeStem(safeName);
  await fs.mkdir(uploadDir, { recursive: true });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const generatedFilename = `${crypto.randomUUID()}-${stem}${extension}`;
    const storagePath = path.join(uploadDir, generatedFilename);
    ensureInsideUploadDir(uploadDir, storagePath);

    try {
      await fs.writeFile(storagePath, buffer, { flag: 'wx' });
      return {
        originalFilename: safeName,
        fileType,
        fileSize: buffer.length,
        storagePath,
      };
    } catch (error) {
      if (error.code !== 'EEXIST' || attempt === 2) throw error;
    }
  }

  throw uploadError('Unable to store uploaded file.');
}

module.exports = {
  DEFAULT_MAX_BYTES,
  isSafeStoragePath,
  isAllowedFileType,
  saveUploadedFile,
  sanitizeOriginalFilename,
};
