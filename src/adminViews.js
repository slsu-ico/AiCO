const {
  CONTENT_TYPE_LABELS,
  FIELD_LIMITS,
  LIST_PAGE_SIZE,
  VALID_CONTENT_TYPES,
} = require('./adminConstants');
const { escapeHtml } = require('./httpUtils');
const { pageLayout } = require('./layout');

function csrfInput(user) {
  return user?.csrfToken
    ? `<input name="_csrf" type="hidden" value="${escapeHtml(user.csrfToken)}">`
    : '';
}

function field(label, name, options = {}) {
  const tag = options.multiline ? 'textarea' : 'input';
  const required = options.required ? ' required' : '';
  const type = options.type || 'text';
  const value = options.value ? ` value="${escapeHtml(options.value)}"` : '';
  const maxlength = options.maxlength ? ` maxlength="${escapeHtml(options.maxlength)}"` : '';
  const body =
    tag === 'textarea'
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
  return String(status ?? '')
    .trim()
    .replace(/_/g, ' ');
}

function option(value, label, selected) {
  const selectedAttr = selected === value ? ' selected' : '';
  return `<option value="${escapeHtml(value)}"${selectedAttr}>${escapeHtml(label)}</option>`;
}

function renderFilterBar({ action, state, statusOptions = [], typeOptions = [] }) {
  const statusSelect =
    statusOptions.length > 0
      ? `
      <label>Status
        <select name="status">
          ${option('', 'All statuses', state.status)}
          ${statusOptions.map((item) => option(item.value, item.label, state.status)).join('')}
        </select>
      </label>
    `
      : '';
  const typeSelect =
    typeOptions.length > 0
      ? `
      <label>Type
        <select name="type">
          ${option('', 'All types', state.type)}
          ${typeOptions.map((item) => option(item.value, item.label, state.type)).join('')}
        </select>
      </label>
    `
      : '';

  return `
    <form class="table-controls" method="get" action="${escapeHtml(action)}">
      <label>Search
        <input name="q" type="search" value="${escapeHtml(state.q)}" placeholder="Search by title, office, or requester">
      </label>
      ${statusSelect}
      ${typeSelect}
      <div class="table-control-actions">
        <button type="submit">Apply</button>
        <a class="button button-secondary" href="${escapeHtml(action)}">Clear</a>
      </div>
    </form>
  `;
}

function pageHref(basePath, state, page) {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.status) params.set('status', state.status);
  if (state.type) params.set('type', state.type);
  params.set('page', String(page));
  return `${basePath}?${params.toString()}`;
}

function renderPagination({ state, total, pageSize = LIST_PAGE_SIZE }) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(state.page, pageCount);
  const previous =
    page > 1
      ? `<a class="button button-secondary" href="${escapeHtml(pageHref(state.basePath, state, page - 1))}">Previous</a>`
      : '<span class="button button-disabled" aria-disabled="true">Previous</span>';
  const next =
    page < pageCount
      ? `<a class="button button-secondary" href="${escapeHtml(pageHref(state.basePath, state, page + 1))}">Next</a>`
      : '<span class="button button-disabled" aria-disabled="true">Next</span>';

  return `
    <nav class="pagination" aria-label="Pagination">
      ${previous}
      <span>Page ${escapeHtml(page)} of ${escapeHtml(pageCount)}</span>
      ${next}
    </nav>
  `;
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

  const body = rows
    .map(
      (submission) => `
    <tr>
      <td>${escapeHtml(submission.title)}</td>
      <td>${escapeHtml(CONTENT_TYPE_LABELS[submission.content_type] || submission.content_type)}</td>
      <td>${escapeHtml(formatStatus(submission.status))}</td>
      <td>${escapeHtml(submission.submitted_at || '')}</td>
      <td>${escapeHtml(submission.latest_admin_note || '')}</td>
    </tr>
  `,
    )
    .join('');

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

function renderOfficeDashboard(user, submissions, options = {}) {
  const state = options.state || { page: 1, q: '', status: '', type: '', basePath: '/admin' };
  const total = Number.isInteger(options.total) ? options.total : submissions.length;

  return pageLayout({
    title: options.title || 'Office dashboard',
    activePath: options.activePath || '/admin',
    user,
    notice: options.notice,
    body: `
      <section>
        <h2>${escapeHtml(options.heading || 'My submissions')}</h2>
        ${renderFilterBar({
          action: options.action || '/admin',
          state,
          statusOptions: [
            { value: 'pending_review', label: 'Pending review' },
            { value: 'needs_revision', label: 'Needs revision' },
            { value: 'published', label: 'Published' },
            { value: 'rejected', label: 'Rejected' },
          ],
        })}
        ${renderOfficeSubmissionRows(submissions)}
        ${renderPagination({ state, total })}
      </section>
      <p><a class="button" href="/admin/content/new">Submit new content</a></p>
    `,
  });
}

function renderAccountRequestRows(rows, user) {
  if (rows.length === 0) {
    return '<p>No account requests to review.</p>';
  }

  const body = rows
    .map(
      (request) => `
    <tr>
      <td>${escapeHtml(request.full_name)}</td>
      <td>${escapeHtml(request.email)}</td>
      <td>${escapeHtml(request.requested_office_name || '')}</td>
      <td>${escapeHtml(request.position)}</td>
      <td>${escapeHtml(request.status)}</td>
      <td><a class="button" href="#request-${escapeHtml(request.id)}">Review</a></td>
    </tr>
  `,
    )
    .join('');

  const modals = rows
    .map(
      (request) => `
    <section class="action-modal" id="request-${escapeHtml(request.id)}" aria-labelledby="request-${escapeHtml(request.id)}-title">
      <a class="modal-backdrop" href="#main-content" aria-label="Close review panel"></a>
      <div class="modal-panel" role="dialog" aria-modal="true">
        <div class="modal-heading">
          <h2 id="request-${escapeHtml(request.id)}-title">${escapeHtml(request.full_name)}</h2>
          <a class="button button-secondary" href="#main-content">Close</a>
        </div>
        <dl class="detail-list">
          <div><dt>Email</dt><dd>${escapeHtml(request.email)}</dd></div>
          <div><dt>Office</dt><dd>${escapeHtml(request.requested_office_name || '')}</dd></div>
          <div><dt>Position</dt><dd>${escapeHtml(request.position)}</dd></div>
          <div><dt>Status</dt><dd>${escapeHtml(request.status)}</dd></div>
        </dl>
        <div class="modal-actions">
        <form method="post" action="/admin/account-requests/${escapeHtml(request.id)}/approve">
          ${csrfInput(user)}
          <h3>Approve</h3>
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
          <h3>Reject</h3>
          <textarea name="admin_note" maxlength="${FIELD_LIMITS.admin_note}" placeholder="Admin note" required></textarea>
          <button class="button-danger" type="submit">Reject</button>
        </form>
        <form method="post" action="/admin/account-requests/${escapeHtml(request.id)}/needs-info">
          ${csrfInput(user)}
          <h3>Needs info</h3>
          <textarea name="admin_note" maxlength="${FIELD_LIMITS.admin_note}" placeholder="Admin note" required></textarea>
          <button type="submit">Needs info</button>
        </form>
        </div>
      </div>
    </section>
  `,
    )
    .join('');

  return `
    <div class="table-scroll">
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
    </div>
    ${modals}
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

  const body = rows
    .map(
      (review) => `
    <tr>
      <td><a href="/admin/reviews/${escapeHtml(review.id)}">${escapeHtml(review.title)}</a></td>
      <td>${escapeHtml(CONTENT_TYPE_LABELS[review.content_type] || review.content_type)}</td>
      <td>${escapeHtml(review.office_name || '')}</td>
      <td>${escapeHtml(review.submitted_at || '')}</td>
    </tr>
  `,
    )
    .join('');

  return `
    <div class="table-scroll">
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
    </div>
  `;
}

function renderContentReviewDetail(review, user, options = {}) {
  const payload = JSON.stringify(review.structured_payload || {}, null, 2);

  return pageLayout({
    title: 'Content review',
    activePath: '/admin/reviews',
    user,
    notice: options.notice,
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

module.exports = {
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
};
