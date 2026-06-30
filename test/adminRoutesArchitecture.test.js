const assert = require('node:assert/strict');
const test = require('node:test');

test('admin route handler is exposed from the admin route composition module', () => {
  const adminRoutes = require('../src/admin/routes');
  const compatibilityRoutes = require('../src/adminRoutes');

  assert.equal(typeof adminRoutes.createAdminRouteHandler, 'function');
  assert.equal(compatibilityRoutes.createAdminRouteHandler, adminRoutes.createAdminRouteHandler);
});
