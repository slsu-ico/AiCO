const http = require('node:http');
const { createHash } = require('node:crypto');
const { Queue, Worker } = require('bullmq');
const Redis = require('ioredis');
const { getConfig } = require('./config');
const { loadKnowledge } = require('./knowledge');
const { createConversation } = require('./conversation');
const { createSender } = require('./messenger');
const { createProcessor } = require('./jobs');
const { createWebhook } = require('./webhook');

function log(event) {
  console.log(JSON.stringify({ event }));
}

function createRedisConnection(config, worker = false) {
  const redis = new Redis(config.redisUrl, {
    lazyConnect: true,
    connectTimeout: 3000,
    maxRetriesPerRequest: worker ? null : 1,
    enableOfflineQueue: worker,
    retryStrategy: (count) => Math.min(count * 100, 2000),
  });
  redis.on('error', () => log('redis_unavailable'));
  return redis;
}

async function createQueueResources(config) {
  const redis = createRedisConnection(config);
  const queue = new Queue('inbound', { connection: redis, prefix: config.namespace });
  queue.on('error', () => log('queue_unavailable'));
  try {
    if (redis.status === 'wait') await redis.connect();
    await queue.waitUntilReady();
    await queue.setGlobalConcurrency(1);
  } catch {
    await queue.close();
    redis.disconnect();
    throw new Error('Redis queue startup failed.');
  }
  const sessionKey = (id) => `${config.namespace}:session:${id}`;
  const getSession = async (id) => {
    const raw = await redis.get(sessionKey(id));
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  };
  const saveSession = async (id, value) =>
    redis.set(sessionKey(id), JSON.stringify(value), 'EX', config.sessionTtl);
  const enqueue = async (events) => {
    await queue.addBulk(
      events.map((event) => ({
        name: 'message',
        data: event,
        opts: {
          jobId: createHash('sha256')
            .update(`${config.pageId}\n${event.senderId}\n${event.id}`)
            .digest('hex'),
          attempts: 1,
          removeOnComplete: { age: config.jobRetentionSeconds },
          removeOnFail: { age: config.jobRetentionSeconds },
        },
      })),
    );
  };
  return {
    redis,
    queue,
    enqueue,
    getSession,
    saveSession,
    close: async () => {
      await queue.close();
      redis.disconnect();
    },
  };
}

async function start(config = getConfig(), { send = createSender(config) } = {}) {
  const services = loadKnowledge();
  const resources = await createQueueResources(config);
  const workerRedis = createRedisConnection(config, true);
  const worker = new Worker(
    'inbound',
    createProcessor({
      conversation: createConversation({ services }),
      send,
      getSession: resources.getSession,
      saveSession: resources.saveSession,
    }),
    {
      connection: workerRedis,
      prefix: config.namespace,
      concurrency: 1,
      lockDuration: 60000,
      maxStalledCount: 1,
    },
  );
  worker.on('error', () => log('worker_error'));
  worker.on('failed', () => log('message_failed'));
  let closed = false;
  const server = http.createServer(
    createWebhook({
      config,
      enqueue: resources.enqueue,
      isReady: async () =>
        !closed &&
        worker.isRunning() &&
        !worker.isPaused() &&
        workerRedis.status === 'ready' &&
        resources.redis.status === 'ready' &&
        (await resources.redis.ping()) === 'PONG',
    }),
  );
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  const close = async () => {
    if (closed) return;
    closed = true;
    await new Promise((resolve) => {
      server.close(() => resolve());
      server.closeIdleConnections();
    });
    await worker.close();
    workerRedis.disconnect();
    await resources.close();
  };
  try {
    await worker.waitUntilReady();
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, '0.0.0.0', resolve);
    });
  } catch {
    await worker.close(true);
    workerRedis.disconnect();
    await resources.close();
    throw new Error('Chatbot startup failed.');
  }
  return { ...resources, worker, server, close };
}

if (require.main === module) {
  start()
    .then((runtime) => {
      log('ico_chatbot_started');
      for (const signal of ['SIGINT', 'SIGTERM']) {
        process.once(signal, () => {
          const timeout = setTimeout(() => process.exit(1), 45000);
          timeout.unref();
          runtime.close().then(
            () => process.exit(0),
            () => process.exit(1),
          );
        });
      }
    })
    .catch(() => {
      console.error(
        'ICO chatbot startup failed. Check required environment settings and Redis availability.',
      );
      process.exitCode = 1;
    });
}
module.exports = { createQueueResources, createRedisConnection, start };
