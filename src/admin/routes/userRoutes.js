const { methodNotAllowed } = require('../../httpUtils');
const {
  handleUserActivation,
  handleUserAssignment,
  handleUsersIndex,
  parseUserAction,
  readForm,
  requireReviewAdmin,
  validateCsrf,
} = require('./handlers');

async function handleUserRoutes(context) {
  const { request, response, url, pathname, services, csrfProtection } = context;

  if (pathname === '/admin/users') {
    const user = await requireReviewAdmin({ request, response, redis: services.redis });
    if (!user) return true;

    if (request.method !== 'GET') {
      methodNotAllowed(response, ['GET']);
      return true;
    }

    await handleUsersIndex({ response, pool: services.pool, user, url });
    return true;
  }

  const userAction = parseUserAction(pathname);
  if (userAction) {
    const user = await requireReviewAdmin({ request, response, redis: services.redis });
    if (!user) return true;

    if (request.method !== 'POST') {
      methodNotAllowed(response, ['POST']);
      return true;
    }

    if (userAction.action === 'assignment') {
      await handleUserAssignment({
        request,
        response,
        pool: services.pool,
        user,
        id: userAction.id,
        csrfProtection,
      });
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

    await handleUserActivation({
      response,
      pool: services.pool,
      id: userAction.id,
      active: userAction.action === 'reactivate',
    });
    return true;
  }

  return false;
}

module.exports = {
  handleUserRoutes,
};
