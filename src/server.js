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

function sendText(response, statusCode, body) {
  response.writeHead(statusCode, { 'content-type': 'text/plain' });
  response.end(body);
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

const BOT_SESSION_TTL_SECONDS = 60 * 60;

function extractIncomingText(event) {
  if (event.message?.quick_reply?.payload) return event.message.quick_reply.payload;
  if (event.message?.text) return event.message.text;
  if (event.postback?.payload) return event.postback.payload;
  return '';
}

function createRequestHandler(options = {}) {
  const verifyToken = options.verifyToken || 'dev-verify-token';
  const hasInjectedServices = Object.prototype.hasOwnProperty.call(options, 'services');
  const hasInjectedFaqs = Object.prototype.hasOwnProperty.call(options, 'faqs');

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

    await setJson(options.redis, `bot_session:${senderId}`, session, { ttlSeconds: BOT_SESSION_TTL_SECONDS });
  }

  const handleAdminRoutes = createAdminRouteHandler({
    pool: options.pool,
    redis: options.redis,
    uploadDir: options.uploadDir,
    sessionSecret: options.sessionSecret,
    secureCookies: options.secureCookies,
    csrfProtection: options.csrfProtection,
  });

  const sendMessage = options.sendMessage || (async (recipientId, reply) => {
    await sendMessengerMessage(options.pageAccessToken, recipientId, reply);
  });

  return async (request, response) => {
    const url = new URL(request.url, 'http://localhost');

    try {
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
        } catch (error) {
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
        sendText(response, statusCode, publicErrorMessage(error, statusCode));
      } else {
        response.end();
      }
    }
  };
}

function createServer(options = {}) {
  return http.createServer(createRequestHandler(options));
}

function startServer() {
  const config = getConfig();
  if (process.env.NODE_ENV === 'production' && config.verifyToken === 'dev-verify-token') {
    throw new Error('MESSENGER_VERIFY_TOKEN must be set in production.');
  }

  const pool = createPool({ databaseUrl: config.databaseUrl });
  const redis = createRedisClient({ redisUrl: config.redisUrl });

  redis.connect().catch((error) => {
    console.error('Failed to connect to Redis:', error);
  });

  const server = createServer({
    verifyToken: config.verifyToken,
    pageAccessToken: config.pageAccessToken,
    pool,
    redis,
    uploadDir: config.uploadDir,
    sessionSecret: config.sessionSecret,
  });

  server.listen(config.port, () => {
    console.log(`ICO Messenger chatbot listening on http://localhost:${config.port}`);
    console.log(`Webhook path: /webhook`);
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
