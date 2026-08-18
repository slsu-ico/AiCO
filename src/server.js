const http = require('node:http');
const { createHash, createHmac, randomUUID, timingSafeEqual } = require('node:crypto');
const { URL } = require('node:url');

const { createInitialSession, handleUserMessage } = require('./conversationEngine');
const { getConfig, getRuntimeConfig, validateConfig } = require('./config');
const { createAdminRouteHandler } = require('./adminRoutes');
const { createRedisClient, getJson, setJson } = require('./cache/redis');
const { createPool } = require('./db/postgres');
const { readBodyBuffer } = require('./httpUtils');
const { loadPublishedFaqs, loadPublishedServices } = require('./publishedContentRepository');
const { loadServices } = require('./serviceRepository');
const { sendMessengerMessage } = require('./messengerApi');

const SERVICE_NAME = 'ico-services-messenger-chatbot';
const DEFAULT_WEBHOOK_MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_MESSENGER_EVENT_DEDUP_TTL_SECONDS = 24 * 60 * 60;
const DEFAULT_MESSENGER_EVENT_PROCESSING_TTL_SECONDS = 5 * 60;
const MESSENGER_EVENT_COMPLETED_VALUE = 'completed';

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
 * @property {string} [messengerAppSecret] Meta app secret used to authenticate webhook payloads.
 * @property {string} [pageAccessToken] Facebook Page access token for outbound replies.
 * @property {object} [pool] PostgreSQL pool-like object.
 * @property {object} [redis] Redis client-like object.
 * @property {string} [uploadDir] Directory used for uploaded files.
 * @property {string} [sessionSecret] Secret used to sign admin session cookies.
 * @property {string[]} [sessionSecrets] Current and previous admin cookie signing secrets.
 * @property {string} [runtimeConfigVersion] Non-secret marker for deployment verification.
 * @property {boolean} [secureCookies] Whether admin cookies must use the Secure flag.
 * @property {boolean} [csrfProtection] Whether admin POST routes enforce CSRF tokens.
 * @property {object} [notificationMailer] Optional review decision mailer.
 * @property {Array<object>} [services] Injected service records for tests or offline runs.
 * @property {Array<object>} [faqs] Injected FAQ records for tests or offline runs.
 * @property {() => Promise<{services: Array<object>, faqs: Array<object>}>} [loadChatbotContent]
 *   Optional shared published-content loader used by Messenger and the authenticated preview.
 * @property {number} [webhookMaxBodyBytes] Maximum accepted Messenger webhook body size.
 * @property {number} [messengerEventDedupTtlSeconds] Redis duplicate-event retention period.
 * @property {Logger} [logger] Structured logger implementation.
 * @property {(recipientId: string, reply: object) => Promise<void>} [sendMessage] Messenger sender override.
 * @property {(event: ChatbotAnalyticsEvent) => void} [trackAnalytics] Analytics sink override.
 */

function sendText(response, statusCode, body) {
  response.writeHead(statusCode, { 'content-type': 'text/plain' });
  response.end(body);
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  });
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

function positiveIntegerOrDefault(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function firstHeaderValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Authenticate a Messenger webhook against the exact bytes Meta signed.
 *
 * Signature verification is optional outside production when no app secret is configured.
 *
 * @param {Buffer} rawBody Unparsed HTTP request body.
 * @param {string|string[]|undefined} signatureHeader X-Hub-Signature-256 header value.
 * @param {string} appSecret Meta app secret.
 * @returns {boolean}
 */
function verifyMessengerSignature(rawBody, signatureHeader, appSecret) {
  if (!appSecret) return true;

  const signature = firstHeaderValue(signatureHeader);
  if (typeof signature !== 'string' || !/^sha256=[a-f\d]{64}$/i.test(signature)) {
    return false;
  }

  const providedDigest = Buffer.from(signature.slice('sha256='.length), 'hex');
  const expectedDigest = createHmac('sha256', appSecret).update(rawBody).digest();
  return (
    providedDigest.length === expectedDigest.length &&
    timingSafeEqual(providedDigest, expectedDigest)
  );
}

function messengerEventId(event) {
  const id = event.message?.mid || event.postback?.mid;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function messengerEventDedupKey(eventId) {
  const digest = createHash('sha256').update(eventId).digest('hex');
  return `messenger:event:${digest}`;
}

async function claimMessengerEvent(redis, eventId, ttlSeconds) {
  if (!redis || !eventId) return { claimed: true, key: null, token: null };

  const key = messengerEventDedupKey(eventId);
  const token = `processing:${randomUUID()}`;
  const result = await redis.set(key, token, {
    condition: 'NX',
    expiration: { type: 'EX', value: ttlSeconds },
  });
  if (result !== null) return { claimed: true, key, token, state: 'processing' };

  const existing = await redis.get(key);
  if (existing === null) {
    const retryResult = await redis.set(key, token, {
      condition: 'NX',
      expiration: { type: 'EX', value: ttlSeconds },
    });
    if (retryResult !== null) return { claimed: true, key, token, state: 'processing' };
  }

  return {
    claimed: false,
    key,
    token: null,
    state: existing === MESSENGER_EVENT_COMPLETED_VALUE ? 'completed' : 'processing',
  };
}

async function releaseMessengerEventClaim(redis, key, token) {
  if (!redis || !key || !token) return false;

  if (typeof redis.eval === 'function') {
    const deleted = await redis.eval(
      `
        if redis.call('GET', KEYS[1]) == ARGV[1] then
          return redis.call('DEL', KEYS[1])
        end
        return 0
      `,
      { keys: [key], arguments: [token] },
    );
    return deleted > 0;
  }

  // Test and in-memory clients do not necessarily implement EVAL. Production Redis
  // uses the atomic script above so an expired worker cannot delete a newer claim.
  if ((await redis.get(key)) !== token) return false;
  return (await redis.del(key)) > 0;
}

async function completeMessengerEventClaim(redis, key, token, ttlSeconds) {
  if (!redis || !key || !token) return false;

  if (typeof redis.eval === 'function') {
    const updated = await redis.eval(
      `
        if redis.call('GET', KEYS[1]) == ARGV[1] then
          redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
          return 1
        end
        return 0
      `,
      {
        keys: [key],
        arguments: [token, MESSENGER_EVENT_COMPLETED_VALUE, String(ttlSeconds)],
      },
    );
    return updated > 0;
  }

  if ((await redis.get(key)) !== token) return false;
  const result = await redis.set(key, MESSENGER_EVENT_COMPLETED_VALUE, {
    condition: 'XX',
    expiration: { type: 'EX', value: ttlSeconds },
  });
  return result !== null;
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

function isSupportedMessengerEvent(event) {
  if (event.message?.is_echo) return false;
  if (typeof event.message?.quick_reply?.payload === 'string') {
    return event.message.quick_reply.payload.length > 0;
  }
  if (typeof event.message?.text === 'string') return event.message.text.trim().length > 0;
  if (typeof event.postback?.payload === 'string') return event.postback.payload.length > 0;
  return false;
}

/**
 * Create the HTTP request handler for the webhook, probes, and admin routes.
 *
 * @param {RequestHandlerOptions} [options] Runtime dependencies and test overrides.
 * @returns {(request: IncomingMessage, response: ServerResponse) => Promise<void>}
 */
function createRequestHandler(options = {}) {
  if (process.env.NODE_ENV === 'production' && !options.messengerAppSecret) {
    throw new Error('MESSENGER_APP_SECRET must be set in production.');
  }

  const verifyTokens = (options.verifyTokens || [options.verifyToken || 'dev-verify-token']).filter(
    Boolean,
  );
  const webhookMaxBodyBytes = positiveIntegerOrDefault(
    options.webhookMaxBodyBytes,
    DEFAULT_WEBHOOK_MAX_BODY_BYTES,
  );
  const messengerEventDedupTtlSeconds = positiveIntegerOrDefault(
    options.messengerEventDedupTtlSeconds,
    DEFAULT_MESSENGER_EVENT_DEDUP_TTL_SECONDS,
  );
  const messengerEventProcessingTtlSeconds = Math.min(
    messengerEventDedupTtlSeconds,
    DEFAULT_MESSENGER_EVENT_PROCESSING_TTL_SECONDS,
  );
  const hasInjectedServices = Object.prototype.hasOwnProperty.call(options, 'services');
  const hasInjectedFaqs = Object.prototype.hasOwnProperty.call(options, 'faqs');
  const senderQueues = new Map();
  const logger = options.logger || createConsoleLogger();
  const trackAnalytics =
    options.trackAnalytics ||
    ((event) => {
      logger.info({ msg: 'chatbot_analytics', ...event });
    });

  async function defaultLoadChatbotContent() {
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

  const loadChatbotContent = options.loadChatbotContent || defaultLoadChatbotContent;

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
    sessionSecrets: options.sessionSecrets,
    secureCookies: options.secureCookies,
    csrfProtection: options.csrfProtection,
    notificationMailer: options.notificationMailer,
    loadChatbotContent,
    logger,
  });

  const sendMessage =
    options.sendMessage ||
    (async (recipientId, reply) => {
      await sendMessengerMessage(options.pageAccessToken, recipientId, reply);
    });

  function enqueueForSender(senderId, task) {
    const previous = senderQueues.get(senderId) || Promise.resolve();
    const current = previous.catch(() => {}).then(task);
    senderQueues.set(senderId, current);
    return current.finally(() => {
      if (senderQueues.get(senderId) === current) senderQueues.delete(senderId);
    });
  }

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
          ...(options.runtimeConfigVersion
            ? { runtimeConfigVersion: options.runtimeConfigVersion }
            : {}),
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

        if (mode === 'subscribe' && verifyTokens.includes(token)) {
          sendText(response, 200, challenge || '');
          return;
        }

        sendText(response, 403, 'Forbidden');
        return;
      }

      if (request.method === 'POST' && url.pathname === '/webhook') {
        let rawBody;
        try {
          rawBody = await readBodyBuffer(request, { maxBytes: webhookMaxBodyBytes });
        } catch (error) {
          if (error.statusCode === 413) {
            sendText(response, 413, 'Payload Too Large');
            return;
          }
          sendText(response, 400, 'Invalid JSON');
          return;
        }

        if (
          !verifyMessengerSignature(
            rawBody,
            request.headers['x-hub-signature-256'],
            options.messengerAppSecret,
          )
        ) {
          sendText(response, 401, 'Invalid signature');
          return;
        }

        let body;
        try {
          body = JSON.parse(rawBody.toString('utf8') || '{}');
        } catch {
          sendText(response, 400, 'Invalid JSON');
          return;
        }

        if (body.object !== 'page') {
          sendText(response, 404, 'Not Found');
          return;
        }

        const events = body.entry?.flatMap((entry) => entry.messaging || []) || [];
        let content;

        for (const event of events) {
          const senderId = event.sender?.id;
          if (!senderId || !isSupportedMessengerEvent(event)) continue;

          const eventId = messengerEventId(event);
          let dedupClaim = null;
          if (eventId && options.redis) {
            try {
              const claim = await claimMessengerEvent(
                options.redis,
                eventId,
                messengerEventProcessingTtlSeconds,
              );
              if (!claim.claimed) {
                if (claim.state === 'processing') {
                  logger.info({ msg: 'messenger_event_in_progress', requestId });
                  response.setHeader('retry-after', '30');
                  sendText(response, 503, 'EVENT_PROCESSING');
                  return;
                }
                logger.info({ msg: 'messenger_event_duplicate_completed', requestId });
                continue;
              }
              dedupClaim = claim;
            } catch (error) {
              logger.error({
                msg: 'messenger_event_dedup_failed',
                requestId,
                error: error.message || String(error),
              });
            }
          }

          try {
            await enqueueForSender(senderId, async () => {
              content ||= await loadChatbotContent();
              const session = (await getBotSession(senderId)) || createInitialSession();
              const incomingText = extractIncomingText(event);
              const result = handleUserMessage(
                session,
                incomingText,
                content.services,
                content.faqs,
                {
                  onInvalid({ contentType, error: validationError }) {
                    logger.error({
                      msg: 'invalid_published_chatbot_content',
                      requestId,
                      contentType,
                      error: validationError.message || String(validationError),
                    });
                  },
                },
              );

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

              if (dedupClaim?.key) {
                try {
                  const completed = await completeMessengerEventClaim(
                    options.redis,
                    dedupClaim.key,
                    dedupClaim.token,
                    messengerEventDedupTtlSeconds,
                  );
                  if (!completed) {
                    logger.error({ msg: 'messenger_event_dedup_completion_lost', requestId });
                  }
                } catch (dedupError) {
                  logger.error({
                    msg: 'messenger_event_dedup_complete_failed',
                    requestId,
                    error: dedupError.message || String(dedupError),
                  });
                }
              }
            });
          } catch (error) {
            throw error;
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
function startServerWithConfig(config) {
  if (process.env.NODE_ENV === 'production' && config.verifyToken === 'dev-verify-token') {
    throw new Error('MESSENGER_VERIFY_TOKEN must be set in production.');
  }
  validateConfig(config);

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
    verifyTokens: config.verifyTokens,
    messengerAppSecret: config.messengerAppSecret,
    pageAccessToken: config.pageAccessToken,
    pool,
    redis,
    uploadDir: config.uploadDir,
    sessionSecret: config.sessionSecret,
    sessionSecrets: config.sessionSecrets,
    runtimeConfigVersion: config.runtimeConfigVersion,
    webhookMaxBodyBytes: config.webhookMaxBodyBytes,
    messengerEventDedupTtlSeconds: config.messengerEventDedupTtlSeconds,
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

function startServer() {
  return startServerWithConfig(getConfig());
}

async function startRuntimeServer() {
  return startServerWithConfig(await getRuntimeConfig());
}

if (require.main === module) {
  startRuntimeServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  claimMessengerEvent,
  completeMessengerEventClaim,
  createRequestHandler,
  createServer,
  extractIncomingText,
  isSupportedMessengerEvent,
  messengerEventId,
  releaseMessengerEventClaim,
  startServer,
  startRuntimeServer,
  verifyMessengerSignature,
};
