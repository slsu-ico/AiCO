const http = require('node:http');
const { URL } = require('node:url');

const { createInitialSession, handleUserMessage } = require('./conversationEngine');
const { getConfig } = require('./config');
const { createAdminRouteHandler } = require('./adminRoutes');
const { createRedisClient, getJson, setJson } = require('./cache/redis');
const { createPool } = require('./db/postgres');
const { loadPublishedFaqs, loadPublishedServices } = require('./publishedContentRepository');
const { loadServices } = require('./serviceRepository');
const { sendMessengerMessage } = require('./messengerApi');

const SERVICE_NAME = 'ico-services-messenger-chatbot';

/**
 * @typedef {import('node:http').IncomingMessage} IncomingMessage
 * @typedef {import('node:http').ServerResponse} ServerResponse
 * @typedef {import('node:http').Server} HttpServer
 */

/**
 * @typedef {object} Logger
 * @property {(entry: Record<string, unknown>) => void} info Write a structured info log.
 * @property {(entry: Record<string, unknown>) => void} error Write a structured error log.
 */

/**
 * @typedef {object} ChatbotAnalyticsEvent
 * @property {string} name Stable analytics event name.
 * @property {string} requestId Request id associated with the event.
 * @property {string} senderId Messenger sender id.
 * @property {string} [reason] Handoff or failure reason.
 * @property {string} [question] User question or FAQ question.
 * @property {string} [serviceId] Matched service id.
 * @property {string} [serviceName] Matched service display name.
 * @property {string} [matchType] How the service was matched.
 */

/**
 * @typedef {object} RequestHandlerOptions
 * @property {string} [verifyToken] Messenger webhook verification token.
 * @property {string} [pageAccessToken] Facebook Page access token for outbound replies.
 * @property {object} [pool] PostgreSQL pool-like object.
 * @property {object} [redis] Redis client-like object.
 * @property {string} [uploadDir] Directory used for uploaded files.
 * @property {string} [sessionSecret] Secret used to sign admin session cookies.
 * @property {boolean} [secureCookies] Whether admin cookies must use the Secure flag.
 * @property {boolean} [csrfProtection] Whether admin POST routes enforce CSRF tokens.
 * @property {object} [notificationMailer] Optional review decision mailer.
 * @property {Array<object>} [services] Injected service records for tests or offline runs.
 * @property {Array<object>} [faqs] Injected FAQ records for tests or offline runs.
 * @property {Logger} [logger] Structured logger implementation.
 * @property {(recipientId: string, reply: object) => Promise<void>} [sendMessage] Messenger sender override.
 * @property {(event: ChatbotAnalyticsEvent) => void} [trackAnalytics] Analytics sink override.
 */

function sendText(response, statusCode, body) {
  response.writeHead(statusCode, { 'content-type': 'text/plain' });
  response.end(body);
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function createRequestId(request) {
  return (
    request.headers['x-request-id'] ||
    request.headers['x-vercel-id'] ||
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  );
}

function createConsoleLogger() {
  function write(level, entry) {
    const payload = {
      level,
      service: SERVICE_NAME,
      timestamp: new Date().toISOString(),
      ...entry,
    };
    const line = JSON.stringify(payload);
    if (level === 'error') {
      console.error(line);
      return;
    }
    console.log(line);
  }

  return {
    info(entry) {
      write('info', entry);
    },
    error(entry) {
      write('error', entry);
    },
  };
}

function publicErrorMessage(error, statusCode) {
  if (statusCode >= 500) return 'Internal Server Error';
  return error.message || 'Internal Server Error';
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8') || '{}';
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

async function checkReadiness(options) {
  const checks = {};

  if (options.pool) {
    try {
      await options.pool.query('select 1');
      checks.postgres = 'ok';
    } catch {
      checks.postgres = 'error';
    }
  } else {
    checks.postgres = 'skipped';
  }

  if (options.redis) {
    try {
      if (typeof options.redis.ping === 'function') {
        await options.redis.ping();
      } else {
        await options.redis.get('__ready__');
      }
      checks.redis = 'ok';
    } catch {
      checks.redis = 'error';
    }
  } else {
    checks.redis = 'skipped';
  }

  const ready = Object.values(checks).every((status) => status !== 'error');
  return {
    statusCode: ready ? 200 : 503,
    body: {
      status: ready ? 'ready' : 'not_ready',
      service: SERVICE_NAME,
      checks,
    },
  };
}

const BOT_SESSION_TTL_SECONDS = 60 * 60;

/**
 * Extract the text or payload from one Messenger webhook event.
 *
 * @param {object} event Messenger event payload.
 * @returns {string}
 */
function extractIncomingText(event) {
  if (event.message?.quick_reply?.payload) return event.message.quick_reply.payload;
  if (event.message?.text) return event.message.text;
  if (event.postback?.payload) return event.postback.payload;
  return '';
}

/**
 * Create the HTTP request handler for the webhook, probes, and admin routes.
 *
 * @param {RequestHandlerOptions} [options] Runtime dependencies and test overrides.
 * @returns {(request: IncomingMessage, response: ServerResponse) => Promise<void>}
 */
function createRequestHandler(options = {}) {
  const verifyToken = options.verifyToken || 'dev-verify-token';
  const hasInjectedServices = Object.prototype.hasOwnProperty.call(options, 'services');
  const hasInjectedFaqs = Object.prototype.hasOwnProperty.call(options, 'faqs');
  const logger = options.logger || createConsoleLogger();
  const trackAnalytics =
    options.trackAnalytics ||
    ((event) => {
      logger.info({ msg: 'chatbot_analytics', ...event });
    });

  async function getChatbotContent() {
    if (!options.pool || !options.redis) {
      return {
        services: hasInjectedServices ? options.services : loadServices(),
        faqs: hasInjectedFaqs ? options.faqs : [],
      };
    }

    const services = hasInjectedServices
      ? options.services
      : await loadPublishedServices({ pool: options.pool, redis: options.redis });
    const faqs = hasInjectedFaqs
      ? options.faqs
      : await loadPublishedFaqs({ pool: options.pool, redis: options.redis });

    return { services, faqs };
  }

  async function getBotSession(senderId) {
    if (!senderId) return null;
    if (!options.redis) return null;
    return getJson(options.redis, `bot_session:${senderId}`);
  }

  async function setBotSession(senderId, session) {
    if (!senderId) return;
    if (!options.redis) return;

    await setJson(options.redis, `bot_session:${senderId}`, session, {
      ttlSeconds: BOT_SESSION_TTL_SECONDS,
    });
  }

  const handleAdminRoutes = createAdminRouteHandler({
    pool: options.pool,
    redis: options.redis,
    uploadDir: options.uploadDir,
    sessionSecret: options.sessionSecret,
    secureCookies: options.secureCookies,
    csrfProtection: options.csrfProtection,
    notificationMailer: options.notificationMailer,
  });

  const sendMessage =
    options.sendMessage ||
    (async (recipientId, reply) => {
      await sendMessengerMessage(options.pageAccessToken, recipientId, reply);
    });

  return async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const requestId = createRequestId(request);
    const start = Date.now();

    response.setHeader('x-request-id', requestId);
    logger.info({
      msg: 'request_start',
      requestId,
      method: request.method,
      route: url.pathname,
    });

    response.once('finish', () => {
      logger.info({
        msg: 'request_done',
        requestId,
        method: request.method,
        route: url.pathname,
        statusCode: response.statusCode,
        ms: Date.now() - start,
      });
    });

    try {
      if (request.method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, {
          status: 'ok',
          service: SERVICE_NAME,
        });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/ready') {
        const readiness = await checkReadiness(options);
        sendJson(response, readiness.statusCode, readiness.body);
        return;
      }

      if (await handleAdminRoutes(request, response, url)) {
        return;
      }

      if (request.method === 'GET' && url.pathname === '/webhook') {
        const mode = url.searchParams.get('hub.mode');
        const token = url.searchParams.get('hub.verify_token');
        const challenge = url.searchParams.get('hub.challenge');

        if (mode === 'subscribe' && token === verifyToken) {
          sendText(response, 200, challenge || '');
          return;
        }

        sendText(response, 403, 'Forbidden');
        return;
      }

      if (request.method === 'POST' && url.pathname === '/webhook') {
        let body;
        try {
          body = await readJson(request);
        } catch {
          sendText(response, 400, 'Invalid JSON');
          return;
        }

        if (body.object !== 'page') {
          sendText(response, 404, 'Not Found');
          return;
        }

        const events = body.entry?.flatMap((entry) => entry.messaging || []) || [];
        const { services, faqs } = await getChatbotContent();

        for (const event of events) {
          const senderId = event.sender?.id;
          if (!senderId) continue;

          const session = (await getBotSession(senderId)) || createInitialSession();
          const incomingText = extractIncomingText(event);
          const result = handleUserMessage(session, incomingText, services, faqs);
          await setBotSession(senderId, result.session);

          for (const analyticsEvent of result.analytics || []) {
            trackAnalytics({
              ...analyticsEvent,
              requestId,
              senderId,
            });
          }

          for (const reply of result.replies) {
            await sendMessage(senderId, reply);
          }
        }

        sendText(response, 200, 'EVENT_RECEIVED');
        return;
      }

      sendText(response, 404, 'Not Found');
    } catch (error) {
      if (!response.headersSent) {
        const statusCode = error.statusCode || 500;
        logger.error({
          msg: 'request_failed',
          requestId,
          method: request.method,
          route: url.pathname,
          error: error.message || String(error),
          ms: Date.now() - start,
        });
        sendText(response, statusCode, publicErrorMessage(error, statusCode));
      } else {
        response.end();
      }
    }
  };
}

/**
 * Create an HTTP server for the chatbot and admin portal.
 *
 * @param {RequestHandlerOptions} [options] Runtime dependencies and test overrides.
 * @returns {HttpServer}
 */
function createServer(options = {}) {
  return http.createServer(createRequestHandler(options));
}

/**
 * Start the configured HTTP server and connect runtime dependencies.
 *
 * @returns {HttpServer}
 */
function startServer() {
  const config = getConfig();
  if (process.env.NODE_ENV === 'production' && config.verifyToken === 'dev-verify-token') {
    throw new Error('MESSENGER_VERIFY_TOKEN must be set in production.');
  }

  const logger = createConsoleLogger();
  const pool = createPool({ databaseUrl: config.databaseUrl });
  const redis = createRedisClient({ redisUrl: config.redisUrl });

  redis.connect().catch((error) => {
    logger.error({
      msg: 'redis_connect_failed',
      error: error.message || String(error),
    });
  });

  const server = createServer({
    verifyToken: config.verifyToken,
    pageAccessToken: config.pageAccessToken,
    pool,
    redis,
    uploadDir: config.uploadDir,
    sessionSecret: config.sessionSecret,
    logger,
  });

  server.listen(config.port, () => {
    logger.info({
      msg: 'server_listening',
      url: `http://localhost:${config.port}`,
      webhookPath: '/webhook',
    });
  });

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  createRequestHandler,
  createServer,
  extractIncomingText,
  startServer,
};
