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

const VALID_ROLES = new Set(['admin', 'office_user']);

function clean(value) {
  return String(value ?? '').trim();
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
  const body = tag === 'textarea'
    ? `<textarea id="${escapeHtml(name)}" name="${escapeHtml(name)}"${required}>${escapeHtml(options.value || '')}</textarea>`
    : `<input id="${escapeHtml(name)}" name="${escapeHtml(name)}" type="${escapeHtml(type)}"${value}${required}>`;

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
        ${field('Full name', 'full_name', { required: true })}
        ${field('Email', 'email', { type: 'email', required: true })}
        ${field('Office name', 'requested_office_name', { required: true })}
        ${field('Position', 'position', { required: true })}
        ${field('Reason', 'reason', { multiline: true })}
        ${field('Remarks', 'remarks', { multiline: true })}
        <button type="submit">Submit request</button>
      </form>
    `,
  });
}

function renderDashboard(user) {
  return pageLayout({
    title: 'Admin dashboard',
    activePath: '/admin',
    user,
    body: '<p>Admin dashboard placeholder</p>',
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

function renderForbidden(response, user) {
  sendHtml(
    response,
    403,
    pageLayout({
      title: 'Forbidden',
      user,
      body: '<p>You do not have access to this page.</p>',
    }),
  );
}

function renderAccountRequestRows(rows) {
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
          <input name="office_id" type="number" min="1" placeholder="Office ID" required>
          <select name="role">
            <option value="office_user">Office user</option>
            <option value="admin">Admin</option>
          </select>
          <input name="password" type="password" placeholder="Temporary password" required>
          <button type="submit">Approve</button>
        </form>
        <form method="post" action="/admin/account-requests/${escapeHtml(request.id)}/reject">
          <textarea name="admin_note" placeholder="Admin note" required></textarea>
          <button class="button-danger" type="submit">Reject</button>
        </form>
        <form method="post" action="/admin/account-requests/${escapeHtml(request.id)}/needs-info">
          <textarea name="admin_note" placeholder="Admin note" required></textarea>
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

async function readForm(request) {
  return parseUrlEncoded(await readBody(request));
}

async function currentSession(redis, request) {
  return getSession(redis, request.headers.cookie || '');
}

async function handleLoginPost({ request, response, pool, redis, secureCookies }) {
  const form = await readForm(request);
  const email = clean(form.email).toLowerCase();
  const password = String(form.password ?? '');

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
    sendHtml(response, 401, renderLogin({ notice: 'Invalid email or password.' }));
    return;
  }

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

  return session.user;
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
      body: renderAccountRequestRows(result.rows),
    }),
  );
}

function parseRequestAction(pathname) {
  const match = pathname.match(/^\/admin\/account-requests\/(\d+)\/(approve|reject|needs-info)$/);
  if (!match) return null;
  return {
    id: Number(match[1]),
    action: match[2],
  };
}

async function handleApprove({ request, response, pool, user, id }) {
  const form = await readForm(request);
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

async function handleReviewStatus({ request, response, pool, user, id, status }) {
  const form = await readForm(request);
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
  };
  const secureCookies = options.secureCookies;
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

      sendHtml(response, 200, renderDashboard(user));
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

    const action = parseRequestAction(pathname);
    if (action) {
      const user = await requireReviewAdmin({ request, response, redis: services.redis });
      if (!user) return true;

      if (request.method !== 'POST') {
        methodNotAllowed(response, ['POST']);
        return true;
      }

      if (action.action === 'approve') {
        await handleApprove({ request, response, pool: services.pool, user, id: action.id });
        return true;
      }

      await handleReviewStatus({
        request,
        response,
        pool: services.pool,
        user,
        id: action.id,
        status: action.action === 'reject' ? 'rejected' : 'needs_info',
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
