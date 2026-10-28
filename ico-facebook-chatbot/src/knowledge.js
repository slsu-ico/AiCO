const fs = require('node:fs');
const path = require('node:path');

const FIELDS = [
  'description',
  'who_may_avail',
  'requirements',
  'submission_timeline',
  'fees',
  'processing_time',
  'official_link',
];
const CONTACT = 'reports@slsu.edu.ph';

function isFormLink(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) {
      return false;
    }
    return (
      (url.hostname === 'forms.gle' && /^\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) ||
      (url.hostname === 'docs.google.com' &&
        /^\/forms\/d\/(?:e\/)?[A-Za-z0-9_-]+\/viewform\/?$/.test(url.pathname))
    );
  } catch {
    return false;
  }
}

function validateKnowledge(records) {
  if (!Array.isArray(records) || !records.length || records.length > 50) {
    throw new Error('Invalid ICO knowledge records.');
  }
  const ids = new Set();
  for (const item of records) {
    if (!item || typeof item !== 'object' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id || '')) {
      throw new Error('Invalid knowledge ID.');
    }
    if (ids.has(item.id)) throw new Error('Duplicate knowledge ID.');
    ids.add(item.id);
    if (
      !['internal', 'external', 'both'].includes(item.audience) ||
      !/^ICO\b/.test(item.office_or_unit || '')
    ) {
      throw new Error('Knowledge must belong to ICO.');
    }
    for (const field of [
      ...FIELDS,
      'service_name',
      'office_or_unit',
      'classification',
      'css_reminder',
    ]) {
      const value = item[field];
      if (['requirements', 'submission_timeline'].includes(field)) {
        if (
          !Array.isArray(value) ||
          !value.length ||
          value.some((v) => typeof v !== 'string' || !v.trim())
        ) {
          throw new Error('Invalid knowledge list.');
        }
      } else if (typeof value !== 'string' || !value.trim()) {
        throw new Error('Invalid knowledge field.');
      }
    }
    if (!isFormLink(item.official_link)) {
      throw new Error('Official form URL must be a respondent link.');
    }
    let text = JSON.stringify(item);
    if (text.length > 16000) throw new Error('Knowledge record too large.');
    // Decode nested percent escapes before scanning URLs; malformed unrelated
    // percent signs in prose must not prevent editor-route detection.
    while (/%[a-f0-9]{2}/i.test(text)) {
      text = text.replace(/%([a-f0-9]{2})/gi, (_match, hex) =>
        String.fromCharCode(parseInt(hex, 16)),
      );
    }
    // Reject editor URLs anywhere, including descriptions and requirements.
    if (
      /https?:[^\s"<>]*\/(?:edit|edit#|edit\?)/i.test(text) ||
      /docs\.google\.com\/forms\/[^\s"<>]*\/(?:edit|prefill)/i.test(text)
    ) {
      throw new Error('Editor URL is prohibited in knowledge.');
    }
  }
  return records;
}

function loadKnowledge(file = path.join(__dirname, '..', 'data', 'services.json')) {
  return validateKnowledge(JSON.parse(fs.readFileSync(file, 'utf8')));
}

module.exports = { FIELDS, CONTACT, isFormLink, loadKnowledge, validateKnowledge };
