const { escapeHtml } = require('./httpUtils');

const navByRole = {
  anonymous: [
    { href: '/login', label: 'Sign in' },
    { href: '/request-account', label: 'Request account' },
  ],
  admin: [
    { href: '/admin', label: 'Dashboard' },
    { href: '/admin/account-requests', label: 'Account requests' },
    { href: '/admin/reviews', label: 'Content reviews' },
  ],
  office_user: [
    { href: '/admin', label: 'Dashboard' },
    { href: '/admin/content/new', label: 'New content' },
    { href: '/admin/submissions', label: 'Submissions' },
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
  const items = navByRole[role];

  return items
    .map((item) => {
      const active = isActive(activePath, item.href);
      const current = active ? ' aria-current="page"' : '';
      const className = active ? ' class="nav-link is-active"' : ' class="nav-link"';
      return `<a${className}${current} href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>`;
    })
    .join('');
}

function pageLayout({ title, body, user = null, activePath = '', notice = '' }) {
  const role = getRole(user);
  const safeTitle = escapeHtml(title || 'Dashboard');
  const safeNotice = escapeHtml(notice);
  const safeUserName = escapeHtml(user?.name || user?.email || '');
  const nav = renderNav({ user, activePath });
  const sessionSummary = user
    ? `<p class="session-user">${safeUserName}<span>${escapeHtml(role.replace('_', ' '))}</span></p>`
    : '<p class="session-user">Public access<span>Account portal</span></p>';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle} - AiCO Admin</title>
  <style>
    :root {
      --slsu-green: #064f35;
      --slsu-green-strong: #043b28;
      --slsu-gold: #b58b19;
      --aico-blue: #1f6fbf;
      --aico-red: #b42318;
      --ink: #17211d;
      --muted: #5f6f68;
      --line: #dbe4df;
      --surface: #ffffff;
      --workspace: #f5f8f6;
      --radius: 8px;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      color: var(--ink);
      background: var(--workspace);
      font-family: Arial, Helvetica, sans-serif;
      font-size: 15px;
      line-height: 1.45;
    }

    a {
      color: inherit;
    }

    .skip-link {
      position: absolute;
      left: 12px;
      top: -48px;
      z-index: 10;
      padding: 8px 10px;
      border-radius: var(--radius);
      color: #fff;
      background: var(--aico-blue);
    }

    .skip-link:focus {
      top: 12px;
    }

    .app-shell {
      min-height: 100vh;
      display: grid;
      grid-template-columns: 260px minmax(0, 1fr);
    }

    .sidebar {
      color: #fff;
      background: var(--slsu-green);
      border-right: 4px solid var(--slsu-gold);
      padding: 20px 16px;
    }

    .brand {
      display: grid;
      gap: 4px;
      padding-bottom: 18px;
      border-bottom: 1px solid rgb(255 255 255 / 20%);
    }

    .brand-university {
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0;
      text-transform: uppercase;
    }

    .brand-product {
      font-size: 24px;
      font-weight: 700;
    }

    .session-user {
      margin: 16px 0;
      padding: 10px;
      border: 1px solid rgb(255 255 255 / 22%);
      border-radius: var(--radius);
      background: var(--slsu-green-strong);
      font-weight: 700;
    }

    .session-user span {
      display: block;
      margin-top: 2px;
      color: rgb(255 255 255 / 78%);
      font-size: 12px;
      font-weight: 400;
      text-transform: capitalize;
    }

    .nav-list {
      display: grid;
      gap: 6px;
    }

    .nav-link {
      display: block;
      min-height: 40px;
      padding: 9px 10px;
      border-left: 4px solid transparent;
      border-radius: var(--radius);
      color: rgb(255 255 255 / 88%);
      text-decoration: none;
    }

    .nav-link:hover,
    .nav-link:focus {
      background: rgb(255 255 255 / 12%);
      outline: none;
    }

    .nav-link.is-active {
      color: #fff;
      background: rgb(255 255 255 / 16%);
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
      min-height: 68px;
      padding: 16px 24px;
      border-bottom: 1px solid var(--line);
      background: #fff;
    }

    .topbar h1 {
      margin: 0;
      font-size: 24px;
      line-height: 1.2;
    }

    .status-pill {
      flex: 0 0 auto;
      border: 1px solid #b8d4f0;
      border-radius: var(--radius);
      color: #124d86;
      background: #eef6ff;
      padding: 5px 8px;
      font-size: 13px;
      font-weight: 700;
    }

    .content {
      width: min(1120px, 100%);
      padding: 24px;
    }

    .notice {
      margin: 0 0 16px;
      border: 1px solid #d9c17a;
      border-left: 4px solid var(--slsu-gold);
      border-radius: var(--radius);
      background: #fff9e8;
      padding: 10px 12px;
      color: #5d4810;
      font-weight: 700;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      background: #fff;
    }

    th,
    td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
    }

    th {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
    }

    input,
    select,
    textarea,
    button {
      font: inherit;
    }

    input,
    select,
    textarea {
      width: 100%;
      min-height: 38px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 8px 10px;
    }

    button,
    .button {
      min-height: 38px;
      border: 0;
      border-radius: var(--radius);
      background: var(--slsu-green);
      color: #fff;
      padding: 8px 12px;
      font-weight: 700;
      text-decoration: none;
      cursor: pointer;
    }

    .button-danger {
      background: var(--aico-red);
    }

    @media (max-width: 760px) {
      .app-shell {
        grid-template-columns: 1fr;
      }

      .sidebar {
        border-right: 0;
        border-bottom: 4px solid var(--slsu-gold);
        padding: 14px;
      }

      .nav-list {
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      }

      .topbar {
        align-items: flex-start;
        flex-direction: column;
        padding: 16px;
      }

      .content {
        padding: 16px;
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
        <h1>${safeTitle}</h1>
        <span class="status-pill">Chatbot status</span>
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
