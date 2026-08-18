const assert = require('node:assert/strict');
const test = require('node:test');

const seededServices = require('../data/services.json');
const {
  ContentPayloadValidationError,
  normalizeFaqPayload,
  normalizePublishedRecords,
  normalizeServicePayload,
} = require('../src/contentPayload');

test('canonical service payload remains backward compatible with every seeded service', () => {
  assert.deepEqual(seededServices.map(normalizeServicePayload), seededServices);
});

test('canonical FAQ payload maps legacy title and body aliases and normalizes keywords', () => {
  assert.deepEqual(
    normalizeFaqPayload({
      title: 'Where is the request form?',
      body: 'Use the official ICO request portal.',
      keywords: 'portal, form\nrequest',
    }),
    {
      question: 'Where is the request form?',
      answer: 'Use the official ICO request portal.',
      keywords: ['portal', 'form', 'request'],
    },
  );
});

test('published-record normalization drops malformed records without dropping valid siblings', () => {
  const validFaq = {
    question: 'Where are the templates?',
    answer: 'Use the official template library.',
  };

  assert.deepEqual(
    normalizePublishedRecords('faq', [{ question: 'Missing answer' }, null, validFaq]),
    [validFaq],
  );
  assert.throws(
    () => normalizeServicePayload({ id: 'broken-service', service_name: 'Broken' }),
    ContentPayloadValidationError,
  );
});

test('published-record normalization reports malformed records without exposing them', () => {
  const diagnostics = [];
  const records = [{ question: 'Missing answer' }, null];

  assert.deepEqual(
    normalizePublishedRecords('faq', records, {
      onInvalid(diagnostic) {
        diagnostics.push(diagnostic);
      },
    }),
    [],
  );
  assert.deepEqual(
    diagnostics.map(({ contentType, index, record }) => ({ contentType, index, record })),
    [
      { contentType: 'faq', index: 0, record: records[0] },
      { contentType: 'faq', index: 1, record: records[1] },
    ],
  );
  assert.ok(diagnostics.every(({ error }) => error instanceof ContentPayloadValidationError));
});
