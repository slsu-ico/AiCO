const { clearSessionCookie, destroySession } = require('../../auth');
const { methodNotAllowed, sendHtml } = require('../../httpUtils');
const { renderAccountRequest, renderLogin } = require('../../adminViews');
const { handleLoginPost, handleRequestAccountPost } = require('./handlers');

async function handleSessionRoutes(context) {
  const { request, response, url, pathname, services, secureCookies } = context;

  if (pathname === '/login') {
    if (request.method === 'GET') {
      sendHtml(response, 200, renderLogin());
      return true;
    }
    if (request.method === 'POST') {
      await handleLoginPost({
        request,
        response,
        pool: services.pool,
        redis: services.redis,
        secureCookies,
      });
      return true;
    }
    methodNotAllowed(response, ['GET', 'POST']);
    return true;
  }

  if (pathname === '/logout') {
    if (request.method !== 'GET') {
      methodNotAllowed(response, ['GET']);
      return true;
    }

    await destroySession(services.redis, request.headers.cookie || '');
    response.writeHead(303, {
      location: '/login',
      'set-cookie': clearSessionCookie({ secure: secureCookies }),
    });
    response.end('');
    return true;
  }

  if (pathname === '/request-account') {
    if (request.method === 'GET') {
      const notice =
        url.searchParams.get('submitted') === '1'
          ? 'Your account request has been submitted for review.'
          : '';
      sendHtml(response, 200, renderAccountRequest({ notice }));
      return true;
    }
    if (request.method === 'POST') {
      await handleRequestAccountPost({ request, response, pool: services.pool });
      return true;
    }
    methodNotAllowed(response, ['GET', 'POST']);
    return true;
  }

  return false;
}

module.exports = {
  handleSessionRoutes,
};
