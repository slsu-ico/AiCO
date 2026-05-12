function getConfig(env = process.env) {
  return {
    port: Number(env.PORT || 3000),
    verifyToken: env.MESSENGER_VERIFY_TOKEN || 'dev-verify-token',
    pageAccessToken: env.PAGE_ACCESS_TOKEN || '',
    databaseUrl: env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/aico',
    redisUrl: env.REDIS_URL || 'redis://localhost:6379',
    uploadDir: env.UPLOAD_DIR || 'uploads',
    sessionSecret: env.SESSION_SECRET || 'dev-session-secret-change-me',
    bootstrapAdminEmail: env.BOOTSTRAP_ADMIN_EMAIL || 'admin@slsu.edu.ph',
    bootstrapAdminPassword: env.BOOTSTRAP_ADMIN_PASSWORD || '',
  };
}

module.exports = {
  getConfig,
};
