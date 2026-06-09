const { escapeHtml } = require('./httpUtils');

const navByRole = {
  anonymous: [
    {
      label: 'Access',
      items: [
        { href: '/login', label: 'Sign in' },
        { href: '/request-account', label: 'Request account' },
      ],
    },
  ],
  admin: [
    {
      label: 'Overview',
      items: [
        { href: '/admin', label: 'Dashboard' },
        { href: '/admin/chatbot-demo', label: 'Chatbot demo' },
      ],
    },
    {
      label: 'Manage',
      items: [
        { href: '/admin/account-requests', label: 'Account requests' },
        { href: '/admin/reviews', label: 'Content reviews' },
        { href: '/admin/users', label: 'Users' },
      ],
    },
  ],
  office_user: [
    {
      label: 'Overview',
      items: [
        { href: '/admin', label: 'Dashboard' },
        { href: '/admin/chatbot-demo', label: 'Chatbot demo' },
      ],
    },
    {
      label: 'Office user',
      items: [
        { href: '/admin/content/new', label: 'New content' },
        { href: '/admin/submissions', label: 'Submissions' },
      ],
    },
  ],
};

function getRole(user) {
  if (user?.role === 'admin') return 'admin';
  if (user?.role === 'office_user') return 'office_user';
  return 'anonymous';
}

function isActive(activePath, href) {
  return activePath === href || (href !== '/admin' && activePath?.startsWith(`${href}/`));
}

function renderNav({ user, activePath = '' }) {
  const role = getRole(user);
  const groups = navByRole[role];

  return groups
    .map((group) => {
      const links = group.items
        .map((item) => {
          const active = isActive(activePath, item.href);
          const current = active ? ' aria-current="page"' : '';
          const className = active ? ' class="nav-link is-active"' : ' class="nav-link"';
          return `<a${className}${current} href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>`;
        })
        .join('');

      return `
        <div class="nav-group">
          <div class="nav-group-label">${escapeHtml(group.label)}</div>
          ${links}
        </div>
      `;
    })
    .join('');
}

function initials(value) {
  const clean = String(value || 'AiCO')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');
  return clean || 'AI';
}

function pageLayout({
  title,
  body,
  user = null,
  activePath = '',
  notice = '',
  subtitle = '',
  topbarAction = '',
}) {
  const role = getRole(user);
  const safeTitle = escapeHtml(title || 'Dashboard');
  const safeSubtitle = escapeHtml(subtitle || '');
  const safeNotice = escapeHtml(notice);
  const safeUserName = escapeHtml(user?.name || user?.email || 'Public access');
  const safeRole = escapeHtml(user ? role.replace('_', ' ') : 'Account portal');
  const nav = renderNav({ user, activePath });
  const sessionSummary = `
    <div class="session-user">
      <div class="sidebar-user-avatar">${escapeHtml(initials(user?.name || user?.email || 'Public'))}</div>
      <div>
        <strong>${safeUserName}</strong>
        <span>${safeRole}</span>
      </div>
    </div>
  `;

  return `<!doctype html>
<html lang="en-PH">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle} - AiCO Admin</title>
  <style>
    :root {
      --slsu-green: #022519;
      --slsu-green-hover: #064f35;
      --slsu-gold: #c89b2c;
      --aico-blue: #1f6fbf;
      --aico-red: #b42318;
      --ink: #17211d;
      --muted: #64736c;
      --line: #dce5df;
      --line-soft: #edf2ef;
      --surface: #ffffff;
      --surface-soft: #f6f9f7;
      --workspace: #f2f6f4;
      --success: #17803d;
      --warning: #8a6110;
      --danger: #b42318;
      --info: #1f6fbf;
      --radius: 8px;
    }

    * {
      box-sizing: border-box;
    }

    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
    }

    body {
      margin: 0;
      color: var(--ink);
      background: var(--workspace);
      font-family: Arial, Helvetica, sans-serif;
      font-size: 14px;
      line-height: 1.45;
    }

    a {
      color: inherit;
    }

    .skip-link {
      position: fixed;
      left: 12px;
      top: 12px;
      z-index: 30;
      padding: 8px 10px;
      border-radius: var(--radius);
      color: #fff;
      background: var(--aico-blue);
      transform: translateY(calc(-100% - 24px));
    }

    .skip-link:focus {
      outline: 3px solid #fff;
      outline-offset: 2px;
      transform: translateY(0);
    }

    .app-shell {
      min-height: 100vh;
      display: grid;
      grid-template-columns: 224px minmax(0, 1fr);
    }

    .sidebar {
      color: #fff;
      background: var(--slsu-green);
      background-image: repeating-linear-gradient(135deg, rgb(255 255 255 / 3%) 0 1px, transparent 1px 12px);
      padding: 16px 14px;
    }

    .brand {
      display: grid;
      gap: 3px;
      padding-bottom: 14px;
      border-bottom: 1px solid rgb(255 255 255 / 14%);
    }

    .brand-university {
      color: rgb(255 255 255 / 54%);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: .5px;
      text-transform: uppercase;
    }

    .brand-product {
      font-size: 20px;
      font-weight: 700;
    }

    .session-user {
      display: flex;
      align-items: center;
      gap: 9px;
      margin: 14px 0;
      padding: 9px;
      border: 1px solid rgb(255 255 255 / 16%);
      border-radius: var(--radius);
      background: rgb(0 0 0 / 18%);
    }

    .sidebar-user-avatar {
      width: 32px;
      height: 32px;
      display: grid;
      place-items: center;
      flex: 0 0 auto;
      border-radius: 50%;
      color: var(--slsu-green);
      background: var(--slsu-gold);
      font-size: 11px;
      font-weight: 700;
    }

    .session-user strong,
    .session-user span {
      display: block;
    }

    .session-user strong {
      font-size: 12px;
      line-height: 1.2;
    }

    .session-user span {
      margin-top: 2px;
      color: rgb(255 255 255 / 58%);
      font-size: 11px;
      text-transform: capitalize;
    }

    .nav-list {
      display: grid;
      gap: 9px;
    }

    .nav-group {
      display: grid;
      gap: 2px;
    }

    .nav-group-label {
      padding: 6px 8px 2px;
      color: rgb(255 255 255 / 42%);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: .55px;
      text-transform: uppercase;
    }

    .nav-link {
      display: flex;
      align-items: center;
      min-height: 32px;
      padding: 7px 9px;
      border-left: 2px solid transparent;
      border-radius: var(--radius);
      color: rgb(255 255 255 / 78%);
      font-size: 12px;
      text-decoration: none;
    }

    .nav-link:hover,
    .nav-link:focus {
      color: #fff;
      background: rgb(255 255 255 / 10%);
      outline: none;
    }

    .nav-link.is-active {
      color: #fff;
      background: rgb(255 255 255 / 14%);
      border-left-color: var(--slsu-gold);
      font-weight: 700;
    }

    .workspace {
      min-width: 0;
      background: var(--surface);
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      min-height: 64px;
      padding: 14px 22px;
      border-bottom: 1px solid var(--line);
      background: #fff;
    }

    .topbar h1 {
      margin: 0;
      font-size: 19px;
      line-height: 1.2;
    }

    .topbar-subtitle {
      margin: 2px 0 0;
      color: var(--muted);
      font-size: 12px;
    }

    .status-pill {
      flex: 0 0 auto;
      border: 1px solid #bad7ef;
      border-radius: var(--radius);
      color: #124d86;
      background: #eef6ff;
      padding: 5px 8px;
      font-size: 12px;
      font-weight: 700;
    }

    .content {
      width: min(1160px, 100%);
      padding: 18px 22px 28px;
    }

    .notice {
      margin: 0 0 14px;
      border: 1px solid #ead99c;
      border-left: 3px solid var(--slsu-gold);
      border-radius: var(--radius);
      background: #fff9e8;
      padding: 9px 11px;
      color: #5d4810;
      font-weight: 700;
      font-size: 12px;
    }

    .panel-section,
    form:not(.metric-card-form):not(.table-controls):not(.chat-demo-input) {
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: #fff;
      padding: 14px;
    }

    section {
      margin-bottom: 14px;
    }

    h2 {
      margin: 0 0 10px;
      font-size: 15px;
    }

    h3 {
      margin: 0 0 8px;
      font-size: 13px;
    }

    p {
      margin-top: 0;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      background: #fff;
      table-layout: fixed;
    }

    th,
    td {
      padding: 9px 10px;
      border-bottom: 1px solid var(--line-soft);
      text-align: left;
      vertical-align: middle;
      overflow-wrap: anywhere;
    }

    tr:last-child td {
      border-bottom: 0;
    }

    tbody tr:hover td {
      background: var(--surface-soft);
    }

    th {
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .35px;
      text-transform: uppercase;
    }

    input,
    select,
    textarea,
    button {
      font: inherit;
    }

    label {
      display: grid;
      gap: 5px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }

    input,
    select,
    textarea {
      width: 100%;
      min-height: 36px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 7px 9px;
      color: var(--ink);
      background: #fff;
      font-size: 13px;
      font-weight: 400;
    }

    textarea {
      min-height: 92px;
      resize: vertical;
    }

    input:focus,
    select:focus,
    textarea:focus {
      border-color: var(--slsu-green-hover);
      outline: 2px solid rgb(6 79 53 / 12%);
    }

    button,
    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 34px;
      border: 1px solid var(--slsu-green);
      border-radius: var(--radius);
      background: var(--slsu-green);
      color: #fff;
      padding: 7px 11px;
      font-size: 12px;
      font-weight: 700;
      text-decoration: none;
      cursor: pointer;
    }

    button:hover,
    .button:hover {
      background: var(--slsu-green-hover);
    }

    .button-danger {
      border-color: var(--aico-red);
      background: var(--aico-red);
    }

    .button-secondary {
      border-color: var(--line);
      color: var(--ink);
      background: #fff;
    }

    .button-secondary:hover {
      background: var(--surface-soft);
    }

    .button-disabled {
      border: 1px solid var(--line);
      color: var(--muted);
      background: #f4f7f5;
      cursor: not-allowed;
    }

    .metric-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 14px;
    }

    .metric-card {
      display: grid;
      align-content: start;
      gap: 4px;
      min-height: 112px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--surface-soft);
      padding: 14px;
      color: var(--ink);
      text-decoration: none;
    }

    .metric-card:hover {
      border-color: var(--slsu-green);
      background: #fff;
    }

    .metric-card-form {
      text-align: left;
    }

    .metric-label {
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }

    .metric-value {
      font-size: 30px;
      font-weight: 700;
      line-height: 1.05;
    }

    .metric-action {
      color: var(--muted);
      font-size: 12px;
    }

    .metric-card-form button {
      width: fit-content;
      margin-top: 5px;
    }

    .table-controls {
      display: grid;
      grid-template-columns: minmax(220px, 1fr) minmax(160px, 220px) auto;
      gap: 10px;
      align-items: end;
      margin: 0 0 12px;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--surface-soft);
    }

    .table-control-actions {
      display: flex;
      gap: 8px;
      align-items: center;
      white-space: nowrap;
    }

    .table-scroll {
      overflow-x: auto;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: #fff;
    }

    .table-scroll table {
      min-width: 760px;
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 11px;
      font-weight: 700;
      white-space: nowrap;
    }

    .status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
    }

    .status-pending,
    .status-pending-review {
      color: var(--info);
    }

    .status-published,
    .status-approved,
    .status-active {
      color: var(--success);
    }

    .status-needs-revision,
    .status-needs-info {
      color: var(--warning);
    }

    .status-rejected,
    .status-inactive {
      color: var(--danger);
    }

    .pagination {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 14px;
    }

    .pagination span {
      color: var(--muted);
      font-weight: 700;
    }

    .action-modal {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 20;
      padding: 20px;
    }

    .action-modal:target {
      display: grid;
      place-items: center;
    }

    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgb(0 0 0 / 48%);
    }

    .modal-panel {
      position: relative;
      z-index: 1;
      width: min(920px, 100%);
      max-height: calc(100vh - 40px);
      overflow: auto;
      border-radius: var(--radius);
      background: #fff;
      padding: 18px;
      box-shadow: 0 18px 54px rgb(0 0 0 / 26%);
    }

    .modal-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 14px;
    }

    .modal-heading h2,
    .modal-actions h3 {
      margin: 0;
    }

    .detail-list {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin: 0 0 16px;
    }

    .detail-list div,
    .modal-actions form {
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 10px;
      background: var(--surface-soft);
    }

    .detail-list dt {
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
    }

    .detail-list dd {
      margin: 2px 0 0;
    }

    .modal-actions {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }

    .modal-actions form {
      display: grid;
      gap: 8px;
      align-content: start;
    }

    .chat-demo-shell {
      display: grid;
      grid-template-rows: auto minmax(260px, 1fr) auto auto;
      max-width: 760px;
      min-height: 560px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      overflow: hidden;
      background: #fff;
    }

    .chat-demo-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 14px;
      background: var(--slsu-green);
      color: #fff;
    }

    .chat-demo-avatar,
    .chat-bot-avatar {
      display: grid;
      place-items: center;
      border-radius: 50%;
      color: var(--slsu-green);
      background: var(--slsu-gold);
      font-weight: 700;
    }

    .chat-demo-avatar {
      width: 34px;
      height: 34px;
      font-size: 11px;
    }

    .chat-demo-header strong,
    .chat-demo-header span {
      display: block;
    }

    .chat-demo-header span {
      color: rgb(255 255 255 / 64%);
      font-size: 11px;
    }

    .chat-demo-reset {
      margin-left: auto;
      border-color: rgb(255 255 255 / 28%);
      color: rgb(255 255 255 / 78%);
      background: transparent;
    }

    .chat-demo-messages {
      display: flex;
      flex-direction: column;
      gap: 8px;
      overflow-y: auto;
      padding: 14px;
      background: var(--surface-soft);
    }

    .chat-message {
      display: flex;
      gap: 7px;
      max-width: 88%;
    }

    .chat-message.is-user {
      align-self: flex-end;
      flex-direction: row-reverse;
    }

    .chat-bot-avatar {
      width: 26px;
      height: 26px;
      flex: 0 0 auto;
      background: #f5eac8;
      font-size: 10px;
    }

    .chat-bubble {
      border: 1px solid var(--line);
      border-radius: 12px;
      border-bottom-left-radius: 4px;
      background: #fff;
      padding: 9px 11px;
      font-size: 13px;
      white-space: pre-wrap;
    }

    .is-user .chat-bubble {
      border-color: var(--slsu-green);
      border-bottom-right-radius: 4px;
      border-bottom-left-radius: 12px;
      color: #fff;
      background: var(--slsu-green);
    }

    .quick-replies {
      display: flex;
      gap: 7px;
      overflow-x: auto;
      padding: 9px 12px;
      border-top: 1px solid var(--line);
      background: #fff;
    }

    .quick-replies button {
      flex: 0 0 auto;
      min-height: 30px;
      border-radius: 999px;
      color: var(--slsu-green);
      background: transparent;
      white-space: nowrap;
    }

    .quick-replies button:hover {
      color: #fff;
      background: var(--slsu-green);
    }

    .chat-demo-input {
      display: flex;
      gap: 8px;
      padding: 10px 12px;
      border-top: 1px solid var(--line);
      background: #fff;
    }

    .chat-demo-input input {
      border-radius: 999px;
    }

    .chat-demo-input button {
      border-radius: 999px;
      min-width: 72px;
    }

    @media (max-width: 760px) {
      .skip-link:focus {
        left: 8px;
        right: 8px;
        text-align: center;
      }

      .app-shell {
        grid-template-columns: 1fr;
      }

      .sidebar {
        padding: 14px;
      }

      .nav-list {
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      }

      .topbar {
        align-items: flex-start;
        flex-direction: column;
        padding: 16px;
      }

      .content {
        padding: 16px;
      }

      .metric-grid,
      .table-controls,
      .detail-list,
      .modal-actions {
        grid-template-columns: 1fr;
      }

      .table-control-actions,
      .pagination {
        justify-content: flex-start;
        flex-wrap: wrap;
      }

      .chat-demo-shell {
        min-height: 520px;
      }
    }
  </style>
</head>
<body>
  <a class="skip-link" href="#main-content">Skip to main content</a>
  <div class="app-shell">
    <aside class="sidebar" aria-label="Admin navigation">
      <div class="brand">
        <span class="brand-university">Southern Luzon State University</span>
        <span class="brand-product">AiCO Admin</span>
      </div>
      ${sessionSummary}
      <nav class="nav-list" aria-label="Primary">${nav}</nav>
    </aside>
    <div class="workspace">
      <header class="topbar">
        <div>
          <h1>${safeTitle}</h1>
          ${safeSubtitle ? `<p class="topbar-subtitle">${safeSubtitle}</p>` : ''}
        </div>
        ${topbarAction || '<span class="status-pill">Chatbot status</span>'}
      </header>
      <main class="content" id="main-content" tabindex="-1">
        ${safeNotice ? `<p class="notice">${safeNotice}</p>` : ''}
        ${body || ''}
      </main>
    </div>
  </div>
</body>
</html>`;
}

module.exports = {
  pageLayout,
  renderNav,
};
