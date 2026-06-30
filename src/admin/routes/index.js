const { notFound } = require('../../httpUtils');
const { requireServices } = require('./handlers');
const { handleAccountRoutes } = require('./accountRoutes');
const { handleContentRoutes } = require('./contentRoutes');
const { handleDashboardRoutes } = require('./dashboardRoutes');
const { handleSessionRoutes } = require('./sessionRoutes');
const { handleUserRoutes } = require('./userRoutes');

function createAdminRouteHandler(options = {}) {
  const services = {
    pool: options.pool,
    redis: options.redis,
    uploadDir: options.uploadDir || 'uploads',
    notificationMailer: options.notificationMailer,
  };
  const secureCookies = options.secureCookies;
  const csrfProtection = options.csrfProtection !== false;
  void options.sessionSecret;

  const routeFamilies = [
    handleSessionRoutes,
    handleDashboardRoutes,
    handleAccountRoutes,
    handleUserRoutes,
    handleContentRoutes,
  ];

  return async function handleAdminRoutes(request, response, url) {
    const pathname = url.pathname;
    const isAdminPath = pathname === '/admin' || pathname.startsWith('/admin/');
    const isPublicAdminPath =
      pathname === '/login' || pathname === '/logout' || pathname === '/request-account';

    if (!isAdminPath && !isPublicAdminPath) {
      return false;
    }

    if (!requireServices(response, services)) return true;

    const context = {
      request,
      response,
      url,
      pathname,
      services,
      secureCookies,
      csrfProtection,
    };

    for (const handleRouteFamily of routeFamilies) {
      if (await handleRouteFamily(context)) {
        return true;
      }
    }

    if (isAdminPath) {
      notFound(response);
      return true;
    }

    return false;
  };
}

module.exports = {
  createAdminRouteHandler,
};
