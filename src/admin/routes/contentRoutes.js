const { methodNotAllowed, sendHtml } = require('../../httpUtils');
const { renderNewContentForm } = require('../../adminViews');
const {
  handleAttachmentMetadataCreate,
  handleContentApprove,
  handleContentHistory,
  handleContentReviewDetail,
  handleContentReviewsIndex,
  handleContentReviewStatus,
  handleContentSubmit,
  handleOfficeSubmissionsIndex,
  parseContentHistory,
  parseContentReviewAction,
  parseContentReviewDetail,
  readForm,
  requireAdmin,
  requireOfficeUser,
  requireReviewAdmin,
  validateCsrf,
} = require('./handlers');

async function handleContentRoutes(context) {
  const { request, response, url, pathname, services, csrfProtection } = context;

  if (pathname === '/admin/submissions') {
    const user = await requireOfficeUser({ request, response, redis: services.redis });
    if (!user) return true;

    if (request.method !== 'GET') {
      methodNotAllowed(response, ['GET']);
      return true;
    }

    await handleOfficeSubmissionsIndex({
      response,
      pool: services.pool,
      user,
      url,
    });
    return true;
  }

  if (pathname === '/admin/content/new') {
    const user = await requireOfficeUser({ request, response, redis: services.redis });
    if (!user) return true;

    if (request.method !== 'GET') {
      methodNotAllowed(response, ['GET']);
      return true;
    }

    const notice =
      url.searchParams.get('submitted') === '1'
        ? 'Your content has been submitted for review.'
        : '';
    sendHtml(response, 200, renderNewContentForm({ user, notice }));
    return true;
  }

  if (pathname === '/admin/content') {
    const user = await requireOfficeUser({ request, response, redis: services.redis });
    if (!user) return true;

    if (request.method !== 'POST') {
      methodNotAllowed(response, ['POST']);
      return true;
    }

    await handleContentSubmit({
      request,
      response,
      pool: services.pool,
      user,
      uploadDir: services.uploadDir,
      csrfProtection,
    });
    return true;
  }

  const contentHistoryId = parseContentHistory(pathname);
  if (contentHistoryId !== null) {
    const user = await requireReviewAdmin({ request, response, redis: services.redis });
    if (!user) return true;

    if (request.method !== 'GET') {
      methodNotAllowed(response, ['GET']);
      return true;
    }

    await handleContentHistory({
      response,
      pool: services.pool,
      user,
      id: contentHistoryId,
    });
    return true;
  }

  if (pathname === '/admin/attachments') {
    const user = await requireAdmin({ request, response, redis: services.redis });
    if (!user) return true;

    if (request.method !== 'POST') {
      methodNotAllowed(response, ['POST']);
      return true;
    }

    if (!(await validateCsrf({ request, response, user, csrfProtection }))) {
      return true;
    }

    await handleAttachmentMetadataCreate({
      request,
      response,
      pool: services.pool,
      user,
    });
    return true;
  }

  if (pathname === '/admin/reviews') {
    const user = await requireReviewAdmin({ request, response, redis: services.redis });
    if (!user) return true;

    if (request.method !== 'GET') {
      methodNotAllowed(response, ['GET']);
      return true;
    }

    await handleContentReviewsIndex({ response, pool: services.pool, user, url });
    return true;
  }

  const contentReviewId = parseContentReviewDetail(pathname);
  if (contentReviewId !== null) {
    const user = await requireReviewAdmin({ request, response, redis: services.redis });
    if (!user) return true;

    if (request.method !== 'GET') {
      methodNotAllowed(response, ['GET']);
      return true;
    }

    await handleContentReviewDetail({
      response,
      pool: services.pool,
      user,
      id: contentReviewId,
      url,
    });
    return true;
  }

  const contentReviewAction = parseContentReviewAction(pathname);
  if (contentReviewAction) {
    const user = await requireReviewAdmin({ request, response, redis: services.redis });
    if (!user) return true;

    if (request.method !== 'POST') {
      methodNotAllowed(response, ['POST']);
      return true;
    }

    if (contentReviewAction.action === 'approve') {
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

      await handleContentApprove({
        response,
        pool: services.pool,
        redis: services.redis,
        user,
        id: contentReviewAction.id,
        notificationMailer: services.notificationMailer,
      });
      return true;
    }

    await handleContentReviewStatus({
      request,
      response,
      pool: services.pool,
      user,
      id: contentReviewAction.id,
      status: contentReviewAction.action === 'reject' ? 'rejected' : 'needs_revision',
      csrfProtection,
      notificationMailer: services.notificationMailer,
    });
    return true;
  }

  return false;
}

module.exports = {
  handleContentRoutes,
};
