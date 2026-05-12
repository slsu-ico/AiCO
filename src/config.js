function getConfig(env = process.env) {
  return {
    port: Number(env.PORT || 3000),
    verifyToken: env.MESSENGER_VERIFY_TOKEN || 'dev-verify-token',
    pageAccessToken: env.PAGE_ACCESS_TOKEN || '',
  };
}

module.exports = {
  getConfig,
};
