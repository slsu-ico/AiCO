const assert = require('node:assert/strict');
const test = require('node:test');

const {
  findServiceById,
  getServicesByAudience,
  loadServices,
  searchServices,
} = require('../src/serviceRepository');

test('loads ICO services from the knowledge base', () => {
  const services = loadServices();

  assert.equal(services.length, 9);
  assert.ok(services.every((service) => service.id));
  assert.ok(services.every((service) => service.official_link.startsWith('https://')));
});

test('filters services by requester audience', () => {
  const internal = getServicesByAudience('internal');
  const external = getServicesByAudience('external');

  assert.equal(internal.length, 7);
  assert.equal(external.length, 2);
  assert.ok(internal.every((service) => service.audience === 'internal'));
  assert.ok(external.every((service) => service.audience === 'external'));
});

test('finds a service by id', () => {
  const service = findServiceById('internal-posting-email-blast');

  assert.equal(service.service_name, 'Request for posting and/or email blast');
  assert.equal(service.processing_time, '30 minutes');
});

test('searches services using free text keywords', () => {
  const matches = searchServices('I need an AVP for our event');

  assert.equal(matches[0].id, 'internal-audiovisual-production');
});

test('returns no search result for questions outside ICO services', () => {
  const matches = searchServices('How do I enroll as a first year student?');

  assert.deepEqual(matches, []);
});
