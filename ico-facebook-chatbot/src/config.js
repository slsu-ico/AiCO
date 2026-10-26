function getConfig(env = process.env) {
  const required = (key) => {
    const value = String(env[key] || '').trim();
    if (!value || /^(?:replace[-_ ]|your[-_ ])/i.test(value)) {
      throw new Error(`${key} is required.`);
    }
    return value;
  };
  const pageId = required('ICO_PAGE_ID');
  if (!/^\d{5,30}$/.test(pageId)) throw new Error('ICO_PAGE_ID is invalid.');
  const pageAccessToken = required('PAGE_ACCESS_TOKEN');
  const appSecret = required('MESSENGER_APP_SECRET');
  const verifyToken = required('MESSENGER_VERIFY_TOKEN');
  if ([pageAccessToken, appSecret, verifyToken].some((s) => s.length < 16)) {
    throw new Error('Messenger secrets are invalid (minimum 16 characters).');
  }
  const graphVersion = required('META_GRAPH_VERSION');
  if (!/^v\d+\.0$/.test(graphVersion)) throw new Error('META_GRAPH_VERSION is invalid.');
  const redisUrl = required('REDIS_URL');
  try {
    const u = new URL(redisUrl);
    if (!['redis:', 'rediss:'].includes(u.protocol) || !u.hostname) throw new Error();
  } catch {
    throw new Error('REDIS_URL is invalid.');
  }
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT is invalid.');
  const namespace = `ico-messenger-${pageId}`;
  return {
    pageId,
    pageAccessToken,
    appSecret,
    verifyToken,
    graphVersion,
    redisUrl,
    port,
    namespace,
    sendTimeoutMs: 8000,
    maxBodyBytes: 256 * 1024,
    sessionTtl: 3600,
    jobRetentionSeconds: 86400,
  };
}
module.exports = { getConfig };
