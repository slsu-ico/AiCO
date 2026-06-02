function clean(value) {
  return String(value ?? '').trim();
}

function parsePositiveInteger(value, fallback = 1) {
  const parsed = Number(clean(value));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function listStateFromUrl(url, options = {}) {
  return {
    page: parsePositiveInteger(url.searchParams.get('page'), 1),
    q: clean(url.searchParams.get('q')),
    status: clean(url.searchParams.get('status')),
    type: clean(url.searchParams.get('type')),
    notice: clean(url.searchParams.get('notice')),
    basePath: options.basePath || url.pathname,
  };
}

function likePattern(value) {
  return `%${value}%`;
}

function totalFromRows(rows) {
  return Number(rows[0]?.total_count || 0);
}

function noticeText(kind, messages) {
  return messages[kind] || '';
}

module.exports = {
  likePattern,
  listStateFromUrl,
  noticeText,
  totalFromRows,
};
