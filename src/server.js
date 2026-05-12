const http = require('node:http');
const { URL } = require('node:url');

const { createInitialSession, handleUserMessage } = require('./conversationEngine');
const { getConfig } = require('./config');
const { createAdminRouteHandler } = require('./adminRoutes');
const { createRedisClient } = require('./cache/redis');
const { createPool } = require('./db/postgres');
const { loadPublishedServices } = require('./publishedContentRepository');
const { loadServices } = require('./serviceRepository');
const { sendMessengerMessage } = require('./messengerApi');

function sendText(response, statusCode, body) {
  response.writeHead(statusCode, { 'content-type': 'text/plain' });
  response.end(body);
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

function extractIncomingText(event) {
  if (event.message?.quick_reply?.payload) return event.message.quick_reply.payload;
  if (event.message?.text) return event.message.text;
  if (event.postback?.payload) return event.postback.payload;
  return '';
}

function createServer(options = {}) {
  const verifyToken = options.verifyToken || 'dev-verify-token';
  const sessions = options.sessions || new Map();
  const hasInjectedServices = Object.prototype.hasOwnProperty.call(options, 'services');

  async function getChatbotServices() {
    if (hasInjectedServices) return options.services;
    if (!options.pool || !options.redis) return loadServices();

    return loadPublishedServices({ pool: options.pool, redis: options.redis });
  }

  const handleAdminRoutes = createAdminRouteHandler({
    pool: options.pool,
    redis: options.redis,
    sessionSecret: options.sessionSecret,
    secureCookies: options.secureCookies,
  });
  const sendMessage = options.sendMessage || (async (recipientId, reply) => {
    await sendMessengerMessage(options.pageAccessToken, recipientId, reply);
  });

  return http.createServer(async (request, response) => {
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
        const services = await getChatbotServices();

        for (const event of events) {
          const senderId = event.sender?.id;
          if (!senderId) continue;

          const session = sessions.get(senderId) || createInitialSession();
          const incomingText = extractIncomingText(event);
          const result = handleUserMessage(session, incomingText, services);
          sessions.set(senderId, result.session);

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
        sendText(response, error.statusCode || 500, error.message || 'Internal Server Error');
      } else {
        response.end();
      }
    }
  });
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
  createServer,
  extractIncomingText,
  startServer,
};
