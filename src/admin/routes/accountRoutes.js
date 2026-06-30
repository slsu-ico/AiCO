const { methodNotAllowed } = require('../../httpUtils');
const {
  handleAccountRequestsIndex,
  handleApprove,
  handleReviewStatus,
  parseRequestAction,
  requireReviewAdmin,
} = require('./handlers');

async function handleAccountRoutes(context) {
  const { request, response, url, pathname, services, csrfProtection } = context;

  if (pathname === '/admin/account-requests') {
    const user = await requireReviewAdmin({ request, response, redis: services.redis });
    if (!user) return true;

    if (request.method !== 'GET') {
      methodNotAllowed(response, ['GET']);
      return true;
    }

    await handleAccountRequestsIndex({ response, pool: services.pool, user, url });
    return true;
  }

  const action = parseRequestAction(pathname);
  if (action) {
    const user = await requireReviewAdmin({ request, response, redis: services.redis });
    if (!user) return true;

    if (request.method !== 'POST') {
      methodNotAllowed(response, ['POST']);
      return true;
    }

    if (action.action === 'approve') {
      await handleApprove({
        request,
        response,
        pool: services.pool,
        user,
        id: action.id,
        csrfProtection,
      });
      return true;
    }

    await handleReviewStatus({
      request,
      response,
      pool: services.pool,
      user,
      id: action.id,
      status: action.action === 'reject' ? 'rejected' : 'needs_info',
      csrfProtection,
    });
    return true;
  }

  return false;
}

module.exports = {
  handleAccountRoutes,
};
