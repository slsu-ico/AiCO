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
  readBodyBuffer,
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

const VALID_ROLES = new Set(['admin', 'office_user']);
const VALID_CONTENT_TYPES = new Set([
  'citizens_charter_service',
  'faq',
  'event',
  'project',
  'program',
  'activity',
]);
const VALID_ATTACHMENT_LINKED_TYPES = new Set(['content_version', 'account_request']);
const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 5;
const LOGIN_RATE_LIMIT_TTL_SECONDS = 15 * 60;

const FIELD_LIMITS = {
  full_name: 160,
  email: 254,
  requested_office_name: 160,
  position: 160,
  reason: 2000,
  remarks: 2000,
  title: 240,
  body: 10000,
  requirements: 5000,
  procedure: 5000,
  fees: 1000,
  processing_time: 1000,
  service_name: 240,
  admin_note: 2000,
  note: 2000,
  password: 256,
};

const FIELD_LABELS = {
  full_name: 'Full name',
  email: 'Email',
  requested_office_name: 'Office name',
  position: 'Position',
  reason: 'Reason',
  remarks: 'Remarks',
  title: 'Title',
  body: 'Body',
  requirements: 'Requirements',
  procedure: 'Procedure',
  fees: 'Fees',
  processing_time: 'Processing time',
  service_name: 'Service name',
  admin_note: 'Admin note',
  note: 'Review note',
  password: 'Password',
};

const CONTENT_TYPE_LABELS = {
  citizens_charter_service: "Citizen's Charter service",
  faq: 'FAQ',
  event: 'Event',
  project: 'Project',
  program: 'Program',
  activity: 'Activity',
};

function clean(value) {
  return String(value ?? '').trim();
}

function csrfInput(user) {
  return user?.csrfToken
    ? `<input name="_csrf" type="hidden" value="${escapeHtml(user.csrfToken)}">`
    : '';
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

function field(label, name, options = {}) {
  const tag = options.multiline ? 'textarea' : 'input';
  const required = options.required ? ' required' : '';
  const type = options.type || 'text';
  const value = options.value ? ` value="${escapeHtml(options.value)}"` : '';
  const maxlength = options.maxlength ? ` maxlength="${escapeHtml(options.maxlength)}"` : '';
  const body = tag === 'textarea'
    ? `<textarea id="${escapeHtml(name)}" name="${escapeHtml(name)}"${maxlength}${required}>${escapeHtml(options.value || '')}</textarea>`
    : `<input id="${escapeHtml(name)}" name="${escapeHtml(name)}" type="${escapeHtml(type)}"${value}${maxlength}${required}>`;

  return `<label>${escapeHtml(label)}${body}</label>`;
}

function renderLogin({ notice = '' } = {}) {
  return pageLayout({
    title: 'Sign in',
    activePath: '/login',
    notice,
    body: `
      <form method="post" action="/login">
        ${field('Email', 'email', { type: 'email', required: true })}
        ${field('Password', 'password', { type: 'password', required: true })}
        <button type="submit">Sign in</button>
      </form>
    `,
  });
}

function renderAccountRequest({ notice = '' } = {}) {
  return pageLayout({
    title: 'Request account',
    activePath: '/request-account',
    notice,
    body: `
      <form method="post" action="/request-account">
        ${field('Full name', 'full_name', { required: true, maxlength: FIELD_LIMITS.full_name })}
        ${field('Email', 'email', { type: 'email', required: true, maxlength: FIELD_LIMITS.email })}
        ${field('Office name', 'requested_office_name', { required: true, maxlength: FIELD_LIMITS.requested_office_name })}
        ${field('Position', 'position', { required: true, maxlength: FIELD_LIMITS.position })}
        ${field('Reason', 'reason', { multiline: true, maxlength: FIELD_LIMITS.reason })}
        ${field('Remarks', 'remarks', { multiline: true, maxlength: FIELD_LIMITS.remarks })}
        <button type="submit">Submit request</button>
      </form>
    `,
  });
}

function formatStatus(status) {
  return clean(status).replace(/_/g, ' ');
}

function renderAdminDashboard(user, counts, options = {}) {
  const safeCounts = {
    pendingAccountRequests: Number(counts.pending_account_requests || 0),
    pendingContentReviews: Number(counts.pending_content_reviews || 0),
    publishedRecords: Number(counts.published_records || 0),
  };

  return pageLayout({
    title: 'Admin dashboard',
    activePath: '/admin',
    user,
    notice: options.notice,
    body: `
      <table aria-label="Administrative counts">
        <thead>
          <tr>
            <th>Queue</th>
            <th>Count</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Pending account requests</td>
            <td><strong>${escapeHtml(safeCounts.pendingAccountRequests)}</strong></td>
            <td><a class="button" href="/admin/account-requests">Review requests</a></td>
          </tr>
          <tr>
            <td>Pending content reviews</td>
            <td><strong>${escapeHtml(safeCounts.pendingContentReviews)}</strong></td>
            <td><a class="button" href="/admin/reviews">Review content</a></td>
          </tr>
          <tr>
            <td>Published records</td>
            <td><strong>${escapeHtml(safeCounts.publishedRecords)}</strong></td>
            <td>
              <form method="post" action="/admin/cache/refresh">
                ${csrfInput(user)}
                <button type="submit">Refresh cache</button>
              </form>
            </td>
          </tr>
        </tbody>
      </table>
    `,
  });
}

function renderOfficeSubmissionRows(rows) {
  if (rows.length === 0) {
    return '<p>No submissions yet.</p>';
  }

  const body = rows.map((submission) => `
    <tr>
      <td>${escapeHtml(submission.title)}</td>
      <td>${escapeHtml(CONTENT_TYPE_LABELS[submission.content_type] || submission.content_type)}</td>
      <td>${escapeHtml(formatStatus(submission.status))}</td>
      <td>${escapeHtml(submission.submitted_at || '')}</td>
      <td>${escapeHtml(submission.latest_admin_note || '')}</td>
    </tr>
  `).join('');

  return `
    <table>
      <thead>
        <tr>
          <th>Title</th>
          <th>Type</th>
          <th>Status</th>
          <th>Submitted</th>
          <th>Latest admin note</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

function renderOfficeDashboard(user, submissions) {
  return pageLayout({
    title: 'Office dashboard',
    activePath: '/admin',
    user,
    body: `
      <section>
        <h2>My submissions</h2>
        ${renderOfficeSubmissionRows(submissions)}
      </section>
      <p><a class="button" href="/admin/content/new">Submit new content</a></p>
    `,
  });
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

function renderAccountRequestRows(rows, user) {
  if (rows.length === 0) {
    return '<p>No account requests to review.</p>';
  }

  const body = rows.map((request) => `
    <tr>
      <td>${escapeHtml(request.full_name)}</td>
      <td>${escapeHtml(request.email)}</td>
      <td>${escapeHtml(request.requested_office_name || '')}</td>
      <td>${escapeHtml(request.position)}</td>
      <td>${escapeHtml(request.status)}</td>
      <td>
        <form method="post" action="/admin/account-requests/${escapeHtml(request.id)}/approve">
          ${csrfInput(user)}
          <input name="office_id" type="number" min="1" placeholder="Office ID" required>
          <select name="role">
            <option value="office_user">Office user</option>
            <option value="admin">Admin</option>
          </select>
          <input name="password" type="password" maxlength="${FIELD_LIMITS.password}" placeholder="Temporary password" required>
          <button type="submit">Approve</button>
        </form>
        <form method="post" action="/admin/account-requests/${escapeHtml(request.id)}/reject">
          ${csrfInput(user)}
          <textarea name="admin_note" maxlength="${FIELD_LIMITS.admin_note}" placeholder="Admin note" required></textarea>
          <button class="button-danger" type="submit">Reject</button>
        </form>
        <form method="post" action="/admin/account-requests/${escapeHtml(request.id)}/needs-info">
          ${csrfInput(user)}
          <textarea name="admin_note" maxlength="${FIELD_LIMITS.admin_note}" placeholder="Admin note" required></textarea>
          <button type="submit">Needs info</button>
        </form>
      </td>
    </tr>
  `).join('');

  return `
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Email</th>
          <th>Office</th>
          <th>Position</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

function contentTypeOptions(selected = '') {
  return [...VALID_CONTENT_TYPES]
    .map((type) => {
      const selectedAttr = selected === type ? ' selected' : '';
      return `<option value="${escapeHtml(type)}"${selectedAttr}>${escapeHtml(CONTENT_TYPE_LABELS[type])}</option>`;
    })
    .join('');
}

function renderNewContentForm({ user, notice = '' }) {
  return pageLayout({
    title: 'New content',
    activePath: '/admin/content/new',
    user,
    notice,
    body: `
      <form method="post" action="/admin/content" enctype="multipart/form-data">
        ${csrfInput(user)}
        <input name="office_id" type="hidden" value="${escapeHtml(user.office_id)}">
        <label>Content type
          <select id="content_type" name="content_type" required>
            ${contentTypeOptions()}
          </select>
        </label>
        ${field('Title', 'title', { required: true, maxlength: FIELD_LIMITS.title })}
        ${field('Body', 'body', { multiline: true, required: true, maxlength: FIELD_LIMITS.body })}
        ${field('Requirements', 'requirements', { multiline: true, maxlength: FIELD_LIMITS.requirements })}
        ${field('Procedure', 'procedure', { multiline: true, maxlength: FIELD_LIMITS.procedure })}
        ${field('Fees', 'fees', { maxlength: FIELD_LIMITS.fees })}
        ${field('Processing time', 'processing_time', { maxlength: FIELD_LIMITS.processing_time })}
        <label>Supporting file
          <input id="attachment" name="attachment" type="file" accept=".pdf,.png,.jpg,.jpeg,.docx,application/pdf,image/png,image/jpeg,application/vnd.openxmlformats-officedocument.wordprocessingml.document">
        </label>
        <button type="submit">Submit for review</button>
      </form>
    `,
  });
}

function renderContentReviewRows(rows) {
  if (rows.length === 0) {
    return '<p>No content submissions are waiting for review.</p>';
  }

  const body = rows.map((review) => `
    <tr>
      <td><a href="/admin/reviews/${escapeHtml(review.id)}">${escapeHtml(review.title)}</a></td>
      <td>${escapeHtml(CONTENT_TYPE_LABELS[review.content_type] || review.content_type)}</td>
      <td>${escapeHtml(review.office_name || '')}</td>
      <td>${escapeHtml(review.submitted_at || '')}</td>
    </tr>
  `).join('');

  return `
    <table>
      <thead>
        <tr>
          <th>Title</th>
          <th>Type</th>
          <th>Office</th>
          <th>Submitted</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

function renderContentReviewDetail(review, user) {
  const payload = JSON.stringify(review.structured_payload || {}, null, 2);

  return pageLayout({
    title: 'Content review',
    activePath: '/admin/reviews',
    user,
    body: `
      <p><strong>${escapeHtml(review.title)}</strong></p>
      <p>${escapeHtml(CONTENT_TYPE_LABELS[review.content_type] || review.content_type)} from ${escapeHtml(review.office_name || '')}</p>
      <p>Status: ${escapeHtml(review.status)}</p>
      <section>
        <h2>Body</h2>
        <p>${escapeHtml(review.body || '')}</p>
      </section>
      <section>
        <h2>Structured payload</h2>
        <pre>${escapeHtml(payload)}</pre>
      </section>
      <form method="post" action="/admin/reviews/${escapeHtml(review.id)}/approve">
        ${csrfInput(user)}
        <button type="submit">Approve and publish</button>
      </form>
      <form method="post" action="/admin/reviews/${escapeHtml(review.id)}/needs-revision">
        ${csrfInput(user)}
        <textarea name="note" maxlength="${FIELD_LIMITS.note}" placeholder="Review note" required></textarea>
        <button type="submit">Needs revision</button>
      </form>
      <form method="post" action="/admin/reviews/${escapeHtml(review.id)}/reject">
        ${csrfInput(user)}
        <textarea name="note" maxlength="${FIELD_LIMITS.note}" placeholder="Review note" required></textarea>
        <button class="button-danger" type="submit">Reject</button>
      </form>
    `,
  });
}

async function readForm(request) {
  return parseUrlEncoded(await readBody(request));
}

function parseContentDisposition(value) {
  const params = {};
  for (const segment of String(value || '').split(';').slice(1)) {
    const index = segment.indexOf('=');
    if (index === -1) continue;

    const key = segment.slice(0, index).trim().toLowerCase();
    let paramValue = segment.slice(index + 1).trim();
    if (paramValue.startsWith('"') && paramValue.endsWith('"')) {
      paramValue = paramValue.slice(1, -1);
    }
    params[key] = paramValue;
  }
  return params;
}

function getMultipartBoundary(contentType) {
  const match = String(contentType || '').match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  return match ? (match[1] || match[2]).trim() : '';
}

async function readMultipartForm(request) {
  const contentType = String(request.headers['content-type'] || '');
  const boundary = getMultipartBoundary(contentType);
  if (!boundary) {
    const error = new Error('Multipart form boundary is required.');
    error.statusCode = 400;
    throw error;
  }

  const raw = (await readBodyBuffer(request)).toString('latin1');
  const parts = raw.split(`--${boundary}`);
  const fields = {};
  const files = {};

  for (const rawPart of parts) {
    if (!rawPart || rawPart === '--\r\n' || rawPart === '--') continue;

    const part = rawPart.replace(/^\r\n/, '').replace(/\r\n--$/, '').replace(/\r\n$/, '');
    const separator = part.indexOf('\r\n\r\n');
    if (separator === -1) continue;

    const rawHeaders = part.slice(0, separator);
    const rawBody = part.slice(separator + 4);
    const headers = {};
    for (const line of rawHeaders.split('\r\n')) {
      const index = line.indexOf(':');
      if (index === -1) continue;
      headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
    }

    const disposition = parseContentDisposition(headers['content-disposition']);
    const name = disposition.name;
    if (!name) continue;

    const body = Buffer.from(rawBody, 'latin1');
    if (Object.hasOwn(disposition, 'filename')) {
      if (!disposition.filename) continue;
      files[name] = {
        originalFilename: disposition.filename,
        contentType: headers['content-type'] || 'application/octet-stream',
        buffer: body,
      };
    } else {
      fields[name] = body.toString('utf8');
    }
  }

  return { fields, files };
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
  const forwardedFor = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwardedFor || request.socket?.remoteAddress || 'unknown';
}

function loginRateLimitKey(request) {
  return `rate:login:${getClientIp(request)}`;
}

async function getLoginAttemptCount(redis, key) {
  const value = await redis.get(key);
  const count = Number(value);
  return Number.isInteger(count) && count > 0 ? count : 0;
}

async function incrementLoginAttempts(redis, key) {
  const nextCount = (await getLoginAttemptCount(redis, key)) + 1;
  await redis.set(key, String(nextCount), {
    expiration: { type: 'EX', value: LOGIN_RATE_LIMIT_TTL_SECONDS },
  });
  return nextCount;
}

function renderTooManyLoginAttempts(response) {
  sendHtml(response, 429, renderLogin({ notice: 'Too many login attempts. Please try again later.' }));
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

  await redis.del(rateLimitKey);

  const session = await createSession(redis, {
    id: user.id,
    office_id: user.office_id,
    email: user.email,
    full_name: user.full_name,
    name: user.full_name,
    role: user.role,
  }, { secure: secureCookies });

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
    sendHtml(response, 400, renderAccountRequest({ notice: 'Full name, email, and position are required.' }));
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

async function handleDashboard({ response, pool, user, notice = '' }) {
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
    const officeId = Number(user.office_id);
    if (!Number.isInteger(officeId) || officeId < 1) {
      sendHtml(response, 200, renderOfficeDashboard(user, []));
      return;
    }

    const result = await pool.query(
      `
        SELECT cv.id,
               cv.title,
               ci.content_type,
               cv.status,
               cv.submitted_at,
               latest_note.note AS latest_admin_note
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
        ORDER BY cv.submitted_at DESC NULLS LAST, cv.id DESC
        LIMIT 25
      `,
      [officeId, user.id],
    );

    sendHtml(response, 200, renderOfficeDashboard(user, result.rows));
    return;
  }

  renderForbidden(response, user);
}

async function handleAccountRequestsIndex({ response, pool, user }) {
  const result = await pool.query(
    `
      SELECT id, full_name, email, requested_office_name, position, status, created_at
      FROM account_requests
      ORDER BY created_at DESC, id DESC
    `,
  );

  sendHtml(
    response,
    200,
    pageLayout({
      title: 'Account requests',
      activePath: '/admin/account-requests',
      user,
      body: renderAccountRequestRows(result.rows, user),
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
      [
        contentItem.id,
        1,
        'pending_review',
        title,
        body,
        payload,
        user.id,
      ],
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

  if (!VALID_ATTACHMENT_LINKED_TYPES.has(linkedType) || !Number.isInteger(linkedId) || linkedId < 1) {
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
    [
      linkedType,
      linkedId,
      originalFilename,
      fileType,
      fileSize,
      storagePath,
      user.id,
    ],
  );

  sendJson(response, 201, { id: result.rows[0].id });
}

async function handleContentReviewsIndex({ response, pool, user }) {
  const result = await pool.query(
    `
      SELECT cv.id,
             cv.title,
             ci.content_type,
             o.name AS office_name,
             cv.submitted_at
      FROM content_versions cv
      JOIN content_items ci ON ci.id = cv.content_item_id
      LEFT JOIN offices o ON o.id = ci.office_id
      WHERE cv.status = 'pending_review'
      ORDER BY cv.submitted_at ASC NULLS LAST, cv.id ASC
    `,
  );

  sendHtml(
    response,
    200,
    pageLayout({
      title: 'Content reviews',
      activePath: '/admin/reviews',
      user,
      body: renderContentReviewRows(result.rows),
    }),
  );
}

async function handleContentReviewDetail({ response, pool, user, id }) {
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

  sendHtml(response, 200, renderContentReviewDetail(review, user));
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

async function handleCacheRefresh({ response, redis }) {
  await invalidatePublishedCache(redis);
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
  redirect(response, '/admin/reviews');
}

async function handleContentReviewStatus({ request, response, pool, user, id, status, csrfProtection }) {
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

  redirect(response, `/admin/reviews/${id}`);
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

  redirect(response, '/admin/account-requests');
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

  redirect(response, '/admin/account-requests');
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
    const isPublicAdminPath = pathname === '/login'
      || pathname === '/logout'
      || pathname === '/request-account';

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
        await handleLoginPost({ request, response, pool: services.pool, redis: services.redis, secureCookies });
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
        const notice = url.searchParams.get('submitted') === '1'
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

      const notice = url.searchParams.get('cache_refreshed') === '1'
        ? 'Published chatbot cache refreshed.'
        : '';
      await handleDashboard({ response, pool: services.pool, user, notice });
      return true;
    }

    if (pathname === '/admin/cache/refresh') {
      const user = await requireReviewAdmin({ request, response, redis: services.redis });
      if (!user) return true;

      if (request.method !== 'POST') {
        methodNotAllowed(response, ['POST']);
        return true;
      }

      if (!(await validateCsrf({ request, response, user, form: await readForm(request), csrfProtection }))) {
        return true;
      }

      await handleCacheRefresh({
        response,
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

      await handleAccountRequestsIndex({ response, pool: services.pool, user });
      return true;
    }

    if (pathname === '/admin/content/new') {
      const user = await requireOfficeUser({ request, response, redis: services.redis });
      if (!user) return true;

      if (request.method !== 'GET') {
        methodNotAllowed(response, ['GET']);
        return true;
      }

      const notice = url.searchParams.get('submitted') === '1'
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

      await handleContentReviewsIndex({ response, pool: services.pool, user });
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
        if (!(await validateCsrf({ request, response, user, form: await readForm(request), csrfProtection }))) {
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
