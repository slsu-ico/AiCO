const {
  CONTENT_TYPE_LABELS,
  FIELD_LABELS,
  FIELD_LIMITS,
  LIST_PAGE_SIZE,
  VALID_ATTACHMENT_LINKED_TYPES,
  VALID_CONTENT_TYPES,
  VALID_ROLES,
} = require('./adminConstants');
const { likePattern, listStateFromUrl, noticeText, totalFromRows } = require('./adminListState');
const { readMultipartForm } = require('./adminMultipart');
const {
  renderAccountRequest,
  renderAccountRequestRows,
  renderAdminDashboard,
  renderContentReviewDetail,
  renderContentReviewRows,
  renderFilterBar,
  renderLogin,
  renderNewContentForm,
  renderOfficeDashboard,
  renderPagination,
} = require('./adminViews');
const {
  clearSessionCookie,
  createSession,
  destroySession,
  getSession,
  hashPassword,
  verifyPassword,
} = require('./auth');
const { withTransaction } = require('./db/postgres');
const {
  escapeHtml,
  methodNotAllowed,
  notFound,
  parseUrlEncoded,
  readBody,
  redirect,
  sendHtml,
} = require('./httpUtils');
const { pageLayout } = require('./layout');
const {
  isAllowedFileType,
  isSafeStoragePath,
  saveUploadedFile,
  sanitizeOriginalFilename,
} = require('./uploads');
const { warmPublishedContentCache } = require('./publishedContentRepository');

const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 5;
const LOGIN_RATE_LIMIT_TTL_SECONDS = 15 * 60;

function clean(value) {
  return String(value ?? '').trim();
}

function exceedsLimit(value, limit) {
  return String(value ?? '').length > limit;
}

function validateFieldLengths(form, fieldNames) {
  for (const fieldName of fieldNames) {
    const limit = FIELD_LIMITS[fieldName];
    if (limit && exceedsLimit(form[fieldName], limit)) {
      return `${FIELD_LABELS[fieldName] || fieldName} must be ${limit} characters or fewer.`;
    }
  }
  return '';
}

function requireServices(response, services) {
  if (services.pool && services.redis) return true;

  sendHtml(
    response,
    503,
    pageLayout({
      title: 'Service unavailable',
      body: '<p>Admin services are not configured.</p>',
    }),
  );
  return false;
}

function renderBadRequest(response, message, user = null) {
  sendHtml(
    response,
    400,
    pageLayout({
      title: 'Bad request',
      user,
      body: `<p>${escapeHtml(message)}</p>`,
    }),
  );
}

function renderForbidden(response, user, message = 'You do not have access to this page.') {
  sendHtml(
    response,
    403,
    pageLayout({
      title: 'Forbidden',
      user,
      body: `<p>${escapeHtml(message)}</p>`,
    }),
  );
}

async function readForm(request) {
  return parseUrlEncoded(await readBody(request));
}

async function readContentForm(request) {
  const contentType = String(request.headers['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('multipart/form-data')) {
    return { fields: await readForm(request), attachment: null };
  }

  const multipart = await readMultipartForm(request);
  return {
    fields: multipart.fields,
    attachment: multipart.files.attachment || null,
  };
}

async function readMetadata(request) {
  const contentType = String(request.headers['content-type'] || '').toLowerCase();

  if (contentType.startsWith('multipart/form-data')) {
    const error = new Error('Attachment metadata must not be submitted as multipart data.');
    error.statusCode = 415;
    throw error;
  }

  const body = await readBody(request);
  if (contentType.startsWith('application/json')) {
    return body ? JSON.parse(body) : {};
  }

  return parseUrlEncoded(body);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
}

async function currentSession(redis, request) {
  return getSession(redis, request.headers.cookie || '');
}

function getClientIp(request) {
  const forwardedFor = String(request.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  return forwardedFor || request.socket?.remoteAddress || 'unknown';
}

function loginRateLimitKey(request) {
  return `rate:login:${getClientIp(request)}`;
}

async function getLoginAttemptCount(redis, key) {
  let value;
  try {
    value = await redis.get(key);
  } catch {
    return 0;
  }
  const count = Number(value);
  return Number.isInteger(count) && count > 0 ? count : 0;
}

async function incrementLoginAttempts(redis, key) {
  const nextCount = (await getLoginAttemptCount(redis, key)) + 1;
  try {
    await redis.set(key, String(nextCount), {
      expiration: { type: 'EX', value: LOGIN_RATE_LIMIT_TTL_SECONDS },
    });
  } catch {
    return nextCount;
  }
  return nextCount;
}

function renderTooManyLoginAttempts(response) {
  sendHtml(
    response,
    429,
    renderLogin({ notice: 'Too many login attempts. Please try again later.' }),
  );
}

async function handleLoginPost({ request, response, pool, redis, secureCookies }) {
  const form = await readForm(request);
  const email = clean(form.email).toLowerCase();
  const password = String(form.password ?? '');
  const rateLimitKey = loginRateLimitKey(request);

  if ((await getLoginAttemptCount(redis, rateLimitKey)) >= LOGIN_RATE_LIMIT_MAX_ATTEMPTS) {
    renderTooManyLoginAttempts(response);
    return;
  }

  const result = await pool.query(
    `
      SELECT id, office_id, email, password_hash, full_name, role, active
      FROM users
      WHERE lower(email) = lower($1)
        AND active = true
      LIMIT 1
    `,
    [email],
  );
  const user = result.rows[0];

  if (!user || !verifyPassword(password, user.password_hash)) {
    await incrementLoginAttempts(redis, rateLimitKey);
    sendHtml(response, 401, renderLogin({ notice: 'Invalid email or password.' }));
    return;
  }

  try {
    await redis.del(rateLimitKey);
  } catch {
    // Login should not fail only because the transient rate-limit key is unavailable.
  }

  const session = await createSession(
    redis,
    {
      id: user.id,
      office_id: user.office_id,
      email: user.email,
      full_name: user.full_name,
      name: user.full_name,
      role: user.role,
    },
    { secure: secureCookies },
  );

  response.writeHead(303, {
    location: '/admin',
    'set-cookie': session.cookieHeader,
  });
  response.end('');
}

async function handleRequestAccountPost({ request, response, pool }) {
  const form = await readForm(request);
  const lengthError = validateFieldLengths(form, [
    'full_name',
    'email',
    'requested_office_name',
    'position',
    'reason',
    'remarks',
  ]);
  if (lengthError) {
    sendHtml(response, 400, renderAccountRequest({ notice: lengthError }));
    return;
  }

  const values = {
    full_name: clean(form.full_name),
    email: clean(form.email).toLowerCase(),
    requested_office_name: clean(form.requested_office_name),
    position: clean(form.position),
    reason: clean(form.reason),
    remarks: clean(form.remarks),
    status: 'pending',
  };

  if (!values.full_name || !values.email || !values.position) {
    sendHtml(
      response,
      400,
      renderAccountRequest({ notice: 'Full name, email, and position are required.' }),
    );
    return;
  }

  await pool.query(
    `
      INSERT INTO account_requests (
        full_name,
        email,
        requested_office_name,
        position,
        reason,
        remarks,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `,
    [
      values.full_name,
      values.email,
      values.requested_office_name,
      values.position,
      values.reason,
      values.remarks,
      values.status,
    ],
  );

  redirect(response, '/request-account?submitted=1');
}

async function requireAdmin({ request, response, redis }) {
  const session = await currentSession(redis, request);
  if (!session?.user) {
    redirect(response, '/login');
    return null;
  }

  return {
    ...session.user,
    csrfToken: session.csrfToken,
  };
}

async function validateCsrf({ request, response, user, form, csrfProtection }) {
  if (!csrfProtection || request.method !== 'POST') return true;

  const token = clean(form?._csrf || request.headers['x-csrf-token']);
  if (token && user?.csrfToken && token === user.csrfToken) {
    return true;
  }

  renderForbidden(response, user, 'Invalid CSRF token.');
  return false;
}

async function requireReviewAdmin(context) {
  const user = await requireAdmin(context);
  if (!user) return null;

  if (user.role !== 'admin') {
    renderForbidden(context.response, user);
    return null;
  }

  return user;
}

async function requireOfficeUser(context) {
  const user = await requireAdmin(context);
  if (!user) return null;

  if (user.role !== 'office_user') {
    renderForbidden(context.response, user);
    return null;
  }

  return user;
}

async function handleDashboard({ response, pool, user, url, notice = '' }) {
  if (user.role === 'admin') {
    const result = await pool.query(
      `
        SELECT
          (
            SELECT count(*)::int
            FROM account_requests
            WHERE status = 'pending'
          ) AS pending_account_requests,
          (
            SELECT count(*)::int
            FROM content_versions
            WHERE status = 'pending_review'
          ) AS pending_content_reviews,
          (
            SELECT count(*)::int
            FROM content_versions
            WHERE status = 'published'
          ) AS published_records
      `,
    );

    sendHtml(response, 200, renderAdminDashboard(user, result.rows[0] || {}, { notice }));
    return;
  }

  if (user.role === 'office_user') {
    await handleOfficeSubmissionsIndex({
      response,
      pool,
      user,
      url,
      notice,
      title: 'Office dashboard',
      heading: 'My submissions',
      activePath: '/admin',
      basePath: '/admin',
    });
    return;
  }

  renderForbidden(response, user);
}

async function handleOfficeSubmissionsIndex({
  response,
  pool,
  user,
  url,
  notice = '',
  title = 'Submission history',
  heading = 'Submission history',
  activePath = '/admin/submissions',
  basePath = '/admin/submissions',
}) {
  const state = listStateFromUrl(url || new URL(`http://localhost${basePath}`), { basePath });
  const officeId = Number(user.office_id);
  if (!Number.isInteger(officeId) || officeId < 1) {
    sendHtml(
      response,
      200,
      renderOfficeDashboard(user, [], {
        state,
        total: 0,
        notice,
        title,
        heading,
        activePath,
        action: basePath,
      }),
    );
    return;
  }

  const filters = [];
  const params = [officeId, user.id];
  if (state.status) {
    params.push(state.status);
    filters.push(`cv.status = $${params.length}`);
  }
  if (state.q) {
    params.push(likePattern(state.q));
    filters.push(`(cv.title ILIKE $${params.length} OR ci.content_type ILIKE $${params.length})`);
  }
  params.push(LIST_PAGE_SIZE, (state.page - 1) * LIST_PAGE_SIZE);
  const limitParam = params.length - 1;
  const offsetParam = params.length;
  const extraWhere = filters.length > 0 ? `AND ${filters.join(' AND ')}` : '';
  const result = await pool.query(
    `
      SELECT cv.id,
             cv.title,
             ci.content_type,
             cv.status,
             cv.submitted_at,
             latest_note.note AS latest_admin_note,
             count(*) OVER() AS total_count
      FROM content_versions cv
      JOIN content_items ci ON ci.id = cv.content_item_id
      LEFT JOIN LATERAL (
        SELECT rn.note
        FROM review_notes rn
        WHERE rn.content_version_id = cv.id
        ORDER BY rn.created_at DESC, rn.id DESC
        LIMIT 1
      ) latest_note ON true
      WHERE ci.office_id = $1
        AND cv.submitted_by = $2
        ${extraWhere}
      ORDER BY cv.submitted_at DESC NULLS LAST, cv.id DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `,
    params,
  );

  sendHtml(
    response,
    200,
    renderOfficeDashboard(user, result.rows, {
      state,
      total: totalFromRows(result.rows),
      notice,
      title,
      heading,
      activePath,
      action: basePath,
    }),
  );
}

async function handleAccountRequestsIndex({ response, pool, user, url }) {
  const state = listStateFromUrl(url || new URL('http://localhost/admin/account-requests'), {
    basePath: '/admin/account-requests',
  });
  const filters = [];
  const params = [];
  if (state.status) {
    params.push(state.status);
    filters.push(`status = $${params.length}`);
  }
  if (state.q) {
    params.push(likePattern(state.q));
    filters.push(
      `(full_name ILIKE $${params.length} OR email ILIKE $${params.length} OR requested_office_name ILIKE $${params.length})`,
    );
  }
  params.push(LIST_PAGE_SIZE, (state.page - 1) * LIST_PAGE_SIZE);
  const limitParam = params.length - 1;
  const offsetParam = params.length;
  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const result = await pool.query(
    `
      SELECT id, full_name, email, requested_office_name, position, status, created_at,
             count(*) OVER() AS total_count
      FROM account_requests
      ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `,
    params,
  );
  const notice = noticeText(state.notice, {
    approved: 'Account request approved.',
    rejected: 'Account request rejected.',
    needs_info: 'Account request marked as needs info.',
  });

  sendHtml(
    response,
    200,
    pageLayout({
      title: 'Account requests',
      activePath: '/admin/account-requests',
      user,
      notice,
      body: `
        ${renderFilterBar({
          action: '/admin/account-requests',
          state,
          statusOptions: [
            { value: 'pending', label: 'Pending' },
            { value: 'approved', label: 'Approved' },
            { value: 'rejected', label: 'Rejected' },
            { value: 'needs_info', label: 'Needs info' },
          ],
        })}
        ${renderAccountRequestRows(result.rows, user)}
        ${renderPagination({ state, total: totalFromRows(result.rows) })}
      `,
    }),
  );
}

function buildContentPayload({ form, user, contentType, title, body }) {
  const payload = {
    title,
    body,
    office_id: Number(user.office_id),
    content_type: contentType,
  };

  if (contentType === 'citizens_charter_service') {
    for (const key of ['requirements', 'procedure', 'fees', 'processing_time', 'service_name']) {
      const value = clean(form[key]);
      if (value) payload[key] = value;
    }
  }

  return payload;
}

async function handleContentSubmit({ request, response, pool, user, uploadDir, csrfProtection }) {
  let submitted;
  try {
    submitted = await readContentForm(request);
  } catch (error) {
    renderBadRequest(response, error.message || 'A valid content form is required.', user);
    return;
  }

  const form = submitted.fields;
  if (!(await validateCsrf({ request, response, user, form, csrfProtection }))) return;

  const lengthError = validateFieldLengths(form, [
    'title',
    'body',
    'requirements',
    'procedure',
    'fees',
    'processing_time',
    'service_name',
  ]);
  if (lengthError) {
    renderBadRequest(response, lengthError, user);
    return;
  }

  const attachment = submitted.attachment;
  const officeId = Number(user.office_id);
  const requestedOfficeId = clean(form.office_id);
  const contentType = clean(form.content_type);
  const title = clean(form.title);
  const body = clean(form.body);

  if (!Number.isInteger(officeId) || officeId < 1) {
    renderForbidden(response, user, 'Content can only be submitted for an assigned office.');
    return;
  }

  if (requestedOfficeId && Number(requestedOfficeId) !== officeId) {
    renderForbidden(response, user, 'Content can only be submitted for your assigned office.');
    return;
  }

  if (!VALID_CONTENT_TYPES.has(contentType)) {
    renderBadRequest(response, 'A valid content type is required.', user);
    return;
  }

  if (!title || !body) {
    renderBadRequest(response, 'Title and body are required.', user);
    return;
  }

  if (attachment && !isAllowedFileType(attachment.contentType)) {
    renderBadRequest(response, 'Unsupported file type.', user);
    return;
  }

  const payload = buildContentPayload({ form, user, contentType, title, body });

  await withTransaction(pool, async (client) => {
    const itemResult = await client.query(
      `
        INSERT INTO content_items (office_id, content_type, created_by)
        VALUES ($1, $2, $3)
        RETURNING id
      `,
      [officeId, contentType, user.id],
    );
    const contentItem = itemResult.rows[0];

    const versionResult = await client.query(
      `
        INSERT INTO content_versions (
          content_item_id,
          version_number,
          status,
          title,
          body,
          structured_payload,
          submitted_by,
          submitted_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, now())
        RETURNING id
      `,
      [contentItem.id, 1, 'pending_review', title, body, payload, user.id],
    );

    if (attachment) {
      let stored;
      try {
        stored = await saveUploadedFile({
          uploadDir,
          originalFilename: attachment.originalFilename,
          contentType: attachment.contentType,
          buffer: attachment.buffer,
        });
      } catch (error) {
        error.statusCode = error.statusCode || 400;
        throw error;
      }

      await client.query(
        `
          INSERT INTO attachments (
            linked_type,
            linked_id,
            original_filename,
            file_type,
            file_size,
            storage_path,
            uploaded_by
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id
        `,
        [
          'content_version',
          versionResult.rows[0].id,
          stored.originalFilename,
          stored.fileType,
          stored.fileSize,
          stored.storagePath,
          user.id,
        ],
      );
    }
  });

  redirect(response, '/admin/content/new?submitted=1');
}

async function handleAttachmentMetadataCreate({ request, response, pool, user }) {
  let metadata;
  try {
    metadata = await readMetadata(request);
  } catch (error) {
    if (error instanceof SyntaxError) {
      renderBadRequest(response, 'Attachment metadata must be valid JSON.', user);
      return;
    }
    if (error.statusCode === 415) {
      response.writeHead(415, {
        'content-type': 'text/plain; charset=utf-8',
      });
      response.end(error.message);
      return;
    }
    throw error;
  }

  const linkedType = clean(metadata.linked_type);
  const linkedId = Number(clean(metadata.linked_id));
  const rawOriginalFilename = clean(metadata.original_filename);
  const originalFilename = rawOriginalFilename ? sanitizeOriginalFilename(rawOriginalFilename) : '';
  const fileType = clean(metadata.file_type).toLowerCase();
  const fileSize = Number(clean(metadata.file_size));
  const storagePath = clean(metadata.storage_path);

  if (
    !VALID_ATTACHMENT_LINKED_TYPES.has(linkedType) ||
    !Number.isInteger(linkedId) ||
    linkedId < 1
  ) {
    renderBadRequest(response, 'A valid linked item is required.', user);
    return;
  }

  if (!originalFilename || !isAllowedFileType(fileType)) {
    renderBadRequest(response, 'A valid attachment file is required.', user);
    return;
  }

  if (!Number.isInteger(fileSize) || fileSize < 0 || !isSafeStoragePath(storagePath)) {
    renderBadRequest(response, 'A valid attachment storage record is required.', user);
    return;
  }

  if (linkedType === 'content_version') {
    const targetResult = await pool.query(
      `
        SELECT cv.id, ci.office_id
        FROM content_versions cv
        JOIN content_items ci ON ci.id = cv.content_item_id
        WHERE cv.id = $1
        LIMIT 1
      `,
      [linkedId],
    );
    const target = targetResult.rows[0];

    if (!target) {
      renderBadRequest(response, 'A valid linked item is required.', user);
      return;
    }

    if (user.role !== 'admin' && Number(target.office_id) !== Number(user.office_id)) {
      renderForbidden(response, user, 'You cannot attach files to content from another office.');
      return;
    }
  }

  if (linkedType === 'account_request') {
    if (user.role !== 'admin') {
      renderForbidden(response, user, 'Only administrators can attach files to account requests.');
      return;
    }

    const targetResult = await pool.query(
      `
        SELECT id
        FROM account_requests
        WHERE id = $1
        LIMIT 1
      `,
      [linkedId],
    );

    if (!targetResult.rows[0]) {
      renderBadRequest(response, 'A valid linked item is required.', user);
      return;
    }
  }

  const result = await pool.query(
    `
      INSERT INTO attachments (
        linked_type,
        linked_id,
        original_filename,
        file_type,
        file_size,
        storage_path,
        uploaded_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `,
    [linkedType, linkedId, originalFilename, fileType, fileSize, storagePath, user.id],
  );

  sendJson(response, 201, { id: result.rows[0].id });
}

async function handleContentReviewsIndex({ response, pool, user, url }) {
  const state = listStateFromUrl(url || new URL('http://localhost/admin/reviews'), {
    basePath: '/admin/reviews',
  });
  const filters = ["cv.status = 'pending_review'"];
  const params = [];
  if (state.type) {
    params.push(state.type);
    filters.push(`ci.content_type = $${params.length}`);
  }
  if (state.q) {
    params.push(likePattern(state.q));
    filters.push(`(cv.title ILIKE $${params.length} OR o.name ILIKE $${params.length})`);
  }
  params.push(LIST_PAGE_SIZE, (state.page - 1) * LIST_PAGE_SIZE);
  const limitParam = params.length - 1;
  const offsetParam = params.length;
  const notice = noticeText(state.notice, {
    approved: 'Content approved and published.',
    rejected: 'Content rejected.',
    needs_revision: 'Content returned for revision.',
  });
  const result = await pool.query(
    `
      SELECT cv.id,
             cv.title,
             ci.content_type,
             o.name AS office_name,
             cv.submitted_at,
             count(*) OVER() AS total_count
      FROM content_versions cv
      JOIN content_items ci ON ci.id = cv.content_item_id
      LEFT JOIN offices o ON o.id = ci.office_id
      WHERE ${filters.join(' AND ')}
      ORDER BY cv.submitted_at ASC NULLS LAST, cv.id ASC
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `,
    params,
  );

  sendHtml(
    response,
    200,
    pageLayout({
      title: 'Content reviews',
      activePath: '/admin/reviews',
      user,
      notice,
      body: `
        ${renderFilterBar({
          action: '/admin/reviews',
          state,
          typeOptions: [...VALID_CONTENT_TYPES].map((type) => ({
            value: type,
            label: CONTENT_TYPE_LABELS[type],
          })),
        })}
        ${renderContentReviewRows(result.rows)}
        ${renderPagination({ state, total: totalFromRows(result.rows) })}
      `,
    }),
  );
}

async function handleContentReviewDetail({ response, pool, user, id, url }) {
  const result = await pool.query(
    `
      SELECT cv.id,
             cv.title,
             cv.body,
             cv.status,
             cv.structured_payload,
             cv.submitted_at,
             ci.office_id,
             ci.content_type,
             o.name AS office_name
      FROM content_versions cv
      JOIN content_items ci ON ci.id = cv.content_item_id
      LEFT JOIN offices o ON o.id = ci.office_id
      WHERE cv.id = $1
      LIMIT 1
    `,
    [id],
  );
  const review = result.rows[0];

  if (!review) {
    notFound(response);
    return;
  }

  const notice = noticeText(clean(url?.searchParams?.get('notice')), {
    rejected: 'Content rejected.',
    needs_revision: 'Content returned for revision.',
  });

  sendHtml(response, 200, renderContentReviewDetail(review, user, { notice }));
}

async function lockContentVersion(client, id) {
  const result = await client.query(
    `
      SELECT id, content_item_id, status
      FROM content_versions
      WHERE id = $1
      FOR UPDATE
    `,
    [id],
  );
  const version = result.rows[0];

  if (!version) {
    const error = new Error('Content version not found.');
    error.statusCode = 404;
    throw error;
  }

  if (version.status !== 'pending_review') {
    const error = new Error('Only pending review content can be reviewed.');
    error.statusCode = 400;
    throw error;
  }

  return version;
}

async function invalidatePublishedCache(redis) {
  await redis.del('published:services');
  await redis.del('published:faqs');
}

async function handleCacheRefresh({ response, pool, redis }) {
  await invalidatePublishedCache(redis);
  await warmPublishedContentCache({ pool, redis });
  redirect(response, '/admin?cache_refreshed=1');
}

async function handleContentApprove({ response, pool, redis, user, id }) {
  await withTransaction(pool, async (client) => {
    const version = await lockContentVersion(client, id);

    await client.query(
      `
        UPDATE content_versions
        SET status = 'published',
            reviewed_by = $2,
            reviewed_at = now(),
            published_at = now(),
            updated_at = now()
        WHERE id = $1
        RETURNING id, content_item_id
      `,
      [id, user.id],
    );

    await client.query(
      `
        UPDATE content_items
        SET current_published_version_id = $2,
            updated_at = now()
        WHERE id = $1
        RETURNING id
      `,
      [version.content_item_id, id],
    );
  });

  await invalidatePublishedCache(redis);
  await warmPublishedContentCache({ pool, redis });
  redirect(response, '/admin/reviews?notice=approved');
}

async function handleContentReviewStatus({
  request,
  response,
  pool,
  user,
  id,
  status,
  csrfProtection,
}) {
  const form = await readForm(request);
  if (!(await validateCsrf({ request, response, user, form, csrfProtection }))) return;

  const lengthError = validateFieldLengths(form, ['note']);
  if (lengthError) {
    renderBadRequest(response, lengthError, user);
    return;
  }

  const note = clean(form.note);

  if (!note) {
    renderBadRequest(response, 'Review note is required.', user);
    return;
  }

  await withTransaction(pool, async (client) => {
    await lockContentVersion(client, id);

    await client.query(
      `
        UPDATE content_versions
        SET status = $2,
            reviewed_by = $3,
            reviewed_at = now(),
            updated_at = now()
        WHERE id = $1
        RETURNING id
      `,
      [id, status, user.id],
    );

    await client.query(
      `
        INSERT INTO review_notes (content_version_id, reviewer_id, action, note)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `,
      [id, user.id, status, note],
    );
  });

  redirect(response, `/admin/reviews/${id}?notice=${status}`);
}

function parseRequestAction(pathname) {
  const match = pathname.match(/^\/admin\/account-requests\/(\d+)\/(approve|reject|needs-info)$/);
  if (!match) return null;
  return {
    id: Number(match[1]),
    action: match[2],
  };
}

function parseContentReviewAction(pathname) {
  const match = pathname.match(/^\/admin\/reviews\/(\d+)\/(approve|reject|needs-revision)$/);
  if (!match) return null;
  return {
    id: Number(match[1]),
    action: match[2],
  };
}

function parseContentReviewDetail(pathname) {
  const match = pathname.match(/^\/admin\/reviews\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

async function handleApprove({ request, response, pool, user, id, csrfProtection }) {
  const form = await readForm(request);
  if (!(await validateCsrf({ request, response, user, form, csrfProtection }))) return;

  const lengthError = validateFieldLengths(form, ['password', 'admin_note']);
  if (lengthError) {
    renderBadRequest(response, lengthError, user);
    return;
  }

  const officeId = Number(clean(form.office_id));
  const role = clean(form.role);
  const password = String(form.password ?? '');
  const adminNote = clean(form.admin_note);

  if (!Number.isInteger(officeId) || officeId < 1) {
    renderBadRequest(response, 'A valid office is required.', user);
    return;
  }

  if (!VALID_ROLES.has(role)) {
    renderBadRequest(response, 'A valid role is required.', user);
    return;
  }

  if (password.trim() === '') {
    renderBadRequest(response, 'A temporary password is required.', user);
    return;
  }

  await withTransaction(pool, async (client) => {
    const requestResult = await client.query(
      `
        SELECT id, full_name, email, status
        FROM account_requests
        WHERE id = $1
        FOR UPDATE
      `,
      [id],
    );
    const accountRequest = requestResult.rows[0];

    if (!accountRequest) {
      const error = new Error('Account request not found.');
      error.statusCode = 404;
      throw error;
    }

    if (accountRequest.status !== 'pending') {
      const error = new Error('Only pending account requests can be approved.');
      error.statusCode = 400;
      throw error;
    }

    await client.query(
      `
        INSERT INTO users (office_id, email, password_hash, full_name, role, active)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `,
      [
        officeId,
        accountRequest.email,
        hashPassword(password),
        accountRequest.full_name,
        role,
        true,
      ],
    );

    await client.query(
      `
        UPDATE account_requests
        SET status = 'approved',
            office_id = $4,
            reviewed_by = $2,
            reviewed_at = now(),
            admin_note = $3,
            updated_at = now()
        WHERE id = $1
        RETURNING id
      `,
      [id, user.id, adminNote, officeId],
    );
  });

  redirect(response, '/admin/account-requests?notice=approved');
}

async function handleReviewStatus({ request, response, pool, user, id, status, csrfProtection }) {
  const form = await readForm(request);
  if (!(await validateCsrf({ request, response, user, form, csrfProtection }))) return;

  const lengthError = validateFieldLengths(form, ['admin_note']);
  if (lengthError) {
    renderBadRequest(response, lengthError, user);
    return;
  }

  const adminNote = clean(form.admin_note);

  if (!adminNote) {
    renderBadRequest(response, 'Admin note is required.', user);
    return;
  }

  await pool.query(
    `
      UPDATE account_requests
      SET status = $2,
          reviewed_by = $3,
          reviewed_at = now(),
          admin_note = $4,
          updated_at = now()
      WHERE id = $1
      RETURNING id
    `,
    [id, status, user.id, adminNote],
  );

  redirect(response, `/admin/account-requests?notice=${status}`);
}

function createAdminRouteHandler(options = {}) {
  const services = {
    pool: options.pool,
    redis: options.redis,
    uploadDir: options.uploadDir || 'uploads',
  };
  const secureCookies = options.secureCookies;
  const csrfProtection = options.csrfProtection !== false;
  void options.sessionSecret;

  return async function handleAdminRoutes(request, response, url) {
    const pathname = url.pathname;
    const isAdminPath = pathname === '/admin' || pathname.startsWith('/admin/');
    const isPublicAdminPath =
      pathname === '/login' || pathname === '/logout' || pathname === '/request-account';

    if (!isAdminPath && !isPublicAdminPath) {
      return false;
    }

    if (!requireServices(response, services)) return true;

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
      });
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
