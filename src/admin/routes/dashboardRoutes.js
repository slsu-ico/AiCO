const { methodNotAllowed, sendHtml } = require('../../httpUtils');
const { renderChatbotDemo, renderChatbotDemoScript } = require('../../adminViews');
const {
  handleCacheRefresh,
  handleDashboard,
  readForm,
  requireAdmin,
  requireReviewAdmin,
  validateCsrf,
} = require('./handlers');

async function handleDashboardRoutes(context) {
  const { request, response, url, pathname, services, csrfProtection } = context;

  if (pathname === '/admin') {
    if (request.method !== 'GET') {
      methodNotAllowed(response, ['GET']);
      return true;
    }
    const user = await requireAdmin({ request, response, redis: services.redis });
    if (!user) return true;

    const notice =
      url.searchParams.get('cache_refreshed') === '1' ? 'Published chatbot cache refreshed.' : '';
    await handleDashboard({ response, pool: services.pool, user, url, notice });
    return true;
  }

  if (pathname === '/admin/chatbot-demo') {
    if (request.method !== 'GET') {
      methodNotAllowed(response, ['GET']);
      return true;
    }
    const user = await requireAdmin({ request, response, redis: services.redis });
    if (!user) return true;

    sendHtml(response, 200, renderChatbotDemo(user));
    return true;
  }

  if (pathname === '/admin/chatbot-demo.js') {
    if (request.method !== 'GET') {
      methodNotAllowed(response, ['GET']);
      return true;
    }
    const user = await requireAdmin({ request, response, redis: services.redis });
    if (!user) return true;

    response.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end(renderChatbotDemoScript());
    return true;
  }

  if (pathname === '/admin/cache/refresh') {
    const user = await requireReviewAdmin({ request, response, redis: services.redis });
    if (!user) return true;

    if (request.method !== 'POST') {
      methodNotAllowed(response, ['POST']);
      return true;
    }

    if (
      !(await validateCsrf({
        request,
        response,
        user,
        form: await readForm(request),
        csrfProtection,
      }))
    ) {
      return true;
    }

    await handleCacheRefresh({
      response,
      pool: services.pool,
      redis: services.redis,
    });
    return true;
  }

  return false;
}

module.exports = {
  handleDashboardRoutes,
};
