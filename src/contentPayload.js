const SERVICE_AUDIENCES = new Set(['internal', 'external']);

class ContentPayloadValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ContentPayloadValidationError';
    this.statusCode = 400;
  }
}

function cleanString(value) {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function requireString(value, label) {
  const normalized = cleanString(value);
  if (!normalized) {
    throw new ContentPayloadValidationError(`${label} is required.`);
  }
  return normalized;
}

function normalizeList(value, { separators = /\r?\n/ } = {}) {
  const items = Array.isArray(value) ? value : cleanString(value).split(separators);
  return items.map(cleanString).filter(Boolean);
}

function requireList(value, label, options) {
  const normalized = normalizeList(value, options);
  if (normalized.length === 0) {
    throw new ContentPayloadValidationError(`${label} must contain at least one item.`);
  }
  return normalized;
}

function requireHttpUrl(value, label) {
  const normalized = requireString(value, label);
  let url;
  try {
    url = new URL(normalized);
  } catch {
    throw new ContentPayloadValidationError(`${label} must be a valid HTTP or HTTPS URL.`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ContentPayloadValidationError(`${label} must be a valid HTTP or HTTPS URL.`);
  }

  return normalized;
}

function normalizeServicePayload(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const id = requireString(source.id ?? source.service_id, 'Service ID').toLowerCase();

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new ContentPayloadValidationError(
      'Service ID must use lowercase letters, numbers, and single hyphens only.',
    );
  }

  const audience = requireString(source.audience, 'Audience').toLowerCase();
  if (!SERVICE_AUDIENCES.has(audience)) {
    throw new ContentPayloadValidationError('Audience must be internal or external.');
  }

  const payload = {
    id,
    audience,
    service_name: requireString(source.service_name ?? source.title, 'Service name'),
    description: requireString(source.description ?? source.body, 'Description'),
    office_or_unit: requireString(source.office_or_unit, 'Office or unit'),
    classification: requireString(source.classification, 'Classification'),
    who_may_avail: requireString(source.who_may_avail, 'Who may avail'),
    requirements: requireList(source.requirements, 'Requirements'),
    submission_timeline: requireList(
      source.submission_timeline ?? source.procedure,
      'Submission timeline',
    ),
    official_link: requireHttpUrl(source.official_link, 'Official link'),
    fees: requireString(source.fees, 'Fees'),
    processing_time: requireString(source.processing_time, 'Processing time'),
    css_reminder: requireString(source.css_reminder, 'Client Satisfaction Survey reminder'),
  };

  const transactionType = cleanString(source.transaction_type);
  if (transactionType) payload.transaction_type = transactionType;

  return payload;
}

function normalizeFaqPayload(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const payload = {
    question: requireString(source.question ?? source.title, 'FAQ question'),
    answer: requireString(source.answer ?? source.body, 'FAQ answer'),
  };
  const keywords = normalizeList(source.keywords, { separators: /[,\r\n]+/ });
  if (keywords.length > 0) payload.keywords = keywords;
  return payload;
}

function normalizeContentPayload(contentType, input) {
  if (contentType === 'citizens_charter_service') return normalizeServicePayload(input);
  if (contentType === 'faq') return normalizeFaqPayload(input);
  throw new ContentPayloadValidationError(`Unsupported chatbot content type: ${contentType}.`);
}

function normalizePublishedRecords(contentType, records, options = {}) {
  if (!Array.isArray(records)) return [];

  const normalized = [];
  for (const [index, record] of records.entries()) {
    try {
      normalized.push(normalizeContentPayload(contentType, record));
    } catch (error) {
      // Published data is an external boundary. Ignore one malformed record instead of
      // allowing it to break every conversation that reads the collection.
      try {
        options.onInvalid?.({ contentType, error, index, record });
      } catch {
        // Diagnostics must never turn malformed external data into a chatbot outage.
      }
    }
  }
  return normalized;
}

module.exports = {
  ContentPayloadValidationError,
  normalizeContentPayload,
  normalizeFaqPayload,
  normalizePublishedRecords,
  normalizeServicePayload,
};
