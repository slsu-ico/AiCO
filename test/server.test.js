const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const test = require('node:test');
const { setImmediate: waitImmediate } = require('node:timers/promises');

const { createServer, releaseMessengerEventClaim, startServer } = require('../src/server');

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(`http://${address.address}:${address.port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function messengerSignature(secret, body) {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

test('verifies Messenger webhook with the correct token', async () => {
  const server = createServer({ verifyToken: 'secret', sendMessage: async () => {} });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(
      `${baseUrl}/webhook?hub.mode=subscribe&hub.verify_token=secret&hub.challenge=abc123`,
    );
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.equal(body, 'abc123');
  } finally {
    await close(server);
  }
});

test('rejects Messenger webhook verification with the wrong token', async () => {
  const server = createServer({ verifyToken: 'secret', sendMessage: async () => {} });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(
      `${baseUrl}/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123`,
    );
    const body = await response.text();

    assert.equal(response.status, 403);
    assert.equal(body, 'Forbidden');
  } finally {
    await close(server);
  }
});

test('verifies Messenger webhook with current or previous token during rotation', async () => {
  const server = createServer({
    verifyTokens: ['current-secret', 'previous-secret'],
    sendMessage: async () => {},
  });
  const baseUrl = await listen(server);

  try {
    const currentResponse = await fetch(
      `${baseUrl}/webhook?hub.mode=subscribe&hub.verify_token=current-secret&hub.challenge=current`,
    );
    const previousResponse = await fetch(
      `${baseUrl}/webhook?hub.mode=subscribe&hub.verify_token=previous-secret&hub.challenge=previous`,
    );

    assert.equal(currentResponse.status, 200);
    assert.equal(await currentResponse.text(), 'current');
    assert.equal(previousResponse.status, 200);
    assert.equal(await previousResponse.text(), 'previous');
  } finally {
    await close(server);
  }
});

test('handles Messenger POST events and sends replies', async () => {
  const sent = [];
  const server = createServer({
    verifyToken: 'secret',
    sendMessage: async (recipientId, reply) => {
      sent.push({ recipientId, reply });
    },
  });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        object: 'page',
        entry: [
          {
            messaging: [
              {
                sender: { id: 'user-1' },
                message: { text: 'hello' },
              },
            ],
          },
        ],
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'EVENT_RECEIVED');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].recipientId, 'user-1');
    assert.match(sent[0].reply.text, /Here are the ICO services/i);
    assert.match(sent[0].reply.text, /Please choose a service/i);
  } finally {
    await close(server);
  }
});

test('accepts a Messenger POST with a valid app-secret signature', async () => {
  const appSecret = 'meta-app-secret';
  const sent = [];
  const body = JSON.stringify({
    object: 'page',
    entry: [
      {
        messaging: [{ sender: { id: 'signed-user' }, message: { text: 'hello' } }],
      },
    ],
  });
  const server = createServer({
    messengerAppSecret: appSecret,
    sendMessage: async (recipientId, reply) => sent.push({ recipientId, reply }),
  });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': messengerSignature(appSecret, body),
      },
      body,
    });

    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'EVENT_RECEIVED');
    assert.equal(sent.length, 1);
  } finally {
    await close(server);
  }
});

test('rejects a Messenger POST with an invalid app-secret signature', async () => {
  const sent = [];
  const body = JSON.stringify({
    object: 'page',
    entry: [{ messaging: [{ sender: { id: 'forged-user' }, message: { text: 'hello' } }] }],
  });
  const server = createServer({
    messengerAppSecret: 'meta-app-secret',
    sendMessage: async (recipientId, reply) => sent.push({ recipientId, reply }),
  });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': `sha256=${'0'.repeat(64)}`,
      },
      body,
    });

    assert.equal(response.status, 401);
    assert.equal(await response.text(), 'Invalid signature');
    assert.equal(sent.length, 0);
  } finally {
    await close(server);
  }
});

test('rejects an oversized Messenger webhook payload', async () => {
  const sent = [];
  const server = createServer({
    webhookMaxBodyBytes: 64,
    sendMessage: async (recipientId, reply) => sent.push({ recipientId, reply }),
  });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ object: 'page', padding: 'x'.repeat(128) }),
    });

    assert.equal(response.status, 413);
    assert.equal(await response.text(), 'Payload Too Large');
    assert.equal(sent.length, 0);
  } finally {
    await close(server);
  }
});

test('deduplicates Messenger events by message id with an atomic Redis claim', async () => {
  const store = new Map();
  const setCalls = [];
  const redis = {
    async get(key) {
      return store.get(key) ?? null;
    },
    async set(key, value, options = {}) {
      setCalls.push({ key, value, options });
      if (options.condition === 'NX' && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    },
    async del(key) {
      return store.delete(key) ? 1 : 0;
    },
  };
  const sent = [];
  const body = JSON.stringify({
    object: 'page',
    entry: [
      {
        messaging: [
          {
            sender: { id: 'duplicate-user' },
            message: { mid: 'message-id-1', text: 'hello' },
          },
        ],
      },
    ],
  });
  const server = createServer({
    redis,
    messengerEventDedupTtlSeconds: 120,
    sendMessage: async (recipientId, reply) => sent.push({ recipientId, reply }),
  });
  const baseUrl = await listen(server);

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(`${baseUrl}/webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      assert.equal(response.status, 200);
      assert.equal(await response.text(), 'EVENT_RECEIVED');
    }

    assert.equal(sent.length, 1);
    const dedupCalls = setCalls.filter((call) => call.key.startsWith('messenger:event:'));
    assert.equal(dedupCalls.length, 3);
    assert.deepEqual(dedupCalls[0].options, {
      condition: 'NX',
      expiration: { type: 'EX', value: 120 },
    });
    assert.equal(dedupCalls[1].value, 'completed');
    assert.deepEqual(dedupCalls[1].options, {
      condition: 'XX',
      expiration: { type: 'EX', value: 120 },
    });
  } finally {
    await close(server);
  }
});

test('ignores Messenger delivery receipts, read receipts, and message echoes', async () => {
  const sent = [];
  const server = createServer({
    services: [],
    sendMessage: async (recipientId, reply) => sent.push({ recipientId, reply }),
  });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        object: 'page',
        entry: [
          {
            messaging: [
              { sender: { id: 'user-1' }, delivery: { mids: ['reply-1'] } },
              { sender: { id: 'user-1' }, read: { watermark: Date.now() } },
              {
                sender: { id: 'page-1' },
                message: { mid: 'echo-1', is_echo: true, text: 'outbound reply' },
              },
              { sender: { id: 'user-1' }, message: { mid: 'message-1', text: 'hello' } },
            ],
          },
        ],
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].recipientId, 'user-1');
  } finally {
    await close(server);
  }
});

test('serializes concurrent events for the same sender within one runtime instance', async () => {
  let sendCalls = 0;
  let releaseFirstSend;
  let markFirstSendStarted;
  const firstSendStarted = new Promise((resolve) => {
    markFirstSendStarted = resolve;
  });
  const firstSendGate = new Promise((resolve) => {
    releaseFirstSend = resolve;
  });
  const server = createServer({
    services: [],
    async sendMessage() {
      sendCalls += 1;
      if (sendCalls === 1) {
        markFirstSendStarted();
        await firstSendGate;
      }
    },
  });
  const baseUrl = await listen(server);

  function postMessage(text) {
    return fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        object: 'page',
        entry: [{ messaging: [{ sender: { id: 'same-user' }, message: { text } }] }],
      }),
    });
  }

  try {
    const first = postMessage('first');
    await firstSendStarted;
    const second = postMessage('second');
    await waitImmediate();
    assert.equal(sendCalls, 1);

    releaseFirstSend();
    const responses = await Promise.all([first, second]);
    assert.deepEqual(
      responses.map((response) => response.status),
      [200, 200],
    );
    assert.equal(sendCalls, 2);
  } finally {
    releaseFirstSend();
    await close(server);
  }
});

test('does not let an expired worker release a newer Messenger event claim', async () => {
  const store = new Map([['messenger:event:key', 'new-worker-token']]);
  const redis = {
    async get(key) {
      return store.get(key) ?? null;
    },
    async del(key) {
      return store.delete(key) ? 1 : 0;
    },
  };

  assert.equal(
    await releaseMessengerEventClaim(redis, 'messenger:event:key', 'expired-worker-token'),
    false,
  );
  assert.equal(store.get('messenger:event:key'), 'new-worker-token');
});

test('returns retryable in-progress status after Messenger processing fails', async () => {
  const store = new Map();
  const redis = {
    async get(key) {
      return store.get(key) ?? null;
    },
    async set(key, value, options = {}) {
      if (options.condition === 'NX' && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    },
    async del(key) {
      return store.delete(key) ? 1 : 0;
    },
  };
  let sendAttempts = 0;
  const server = createServer({
    redis,
    services: [],
    sendMessage: async () => {
      sendAttempts += 1;
      throw new Error('Messenger is temporarily unavailable');
    },
  });
  const baseUrl = await listen(server);
  const body = JSON.stringify({
    object: 'page',
    entry: [
      {
        messaging: [
          {
            sender: { id: 'user-1' },
            message: { mid: 'message-with-side-effects', text: 'hello' },
          },
        ],
      },
    ],
  });

  try {
    const first = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    const retry = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });

    assert.equal(first.status, 500);
    assert.equal(retry.status, 503);
    assert.equal(retry.headers.get('retry-after'), '30');
    assert.equal(await retry.text(), 'EVENT_PROCESSING');
    assert.equal(sendAttempts, 1);
  } finally {
    await close(server);
  }
});

test('returns liveness details for health probes', async () => {
  const server = createServer({
    verifyToken: 'secret',
    runtimeConfigVersion: 'runtime-version-2',
    sendMessage: async () => {},
  });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'ico-services-messenger-chatbot');
    assert.equal(body.runtimeConfigVersion, 'runtime-version-2');
  } finally {
    await close(server);
  }
});

test('returns readiness details for dependency probes', async () => {
  const redis = {
    async ping() {
      return 'PONG';
    },
  };
  const pool = {
    async query(text) {
      assert.equal(text, 'select 1');
      return { rows: [{ '?column?': 1 }] };
    },
  };
  const server = createServer({ verifyToken: 'secret', pool, redis, sendMessage: async () => {} });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/ready`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, 'ready');
    assert.deepEqual(body.checks, { postgres: 'ok', redis: 'ok' });
  } finally {
    await close(server);
  }
});

test('returns 503 readiness details when a dependency is unavailable', async () => {
  const redis = {
    async ping() {
      throw new Error('redis offline');
    },
  };
  const pool = {
    async query() {
      return { rows: [{ '?column?': 1 }] };
    },
  };
  const server = createServer({ verifyToken: 'secret', pool, redis, sendMessage: async () => {} });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/ready`);
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(body.status, 'not_ready');
    assert.deepEqual(body.checks, { postgres: 'ok', redis: 'error' });
  } finally {
    await close(server);
  }
});

test('emits structured request logs with request IDs', async () => {
  const records = [];
  const logger = {
    info(entry) {
      records.push({ ...entry, level: 'info' });
    },
    error(entry) {
      records.push({ ...entry, level: 'error' });
    },
  };
  const server = createServer({ verifyToken: 'secret', logger, sendMessage: async () => {} });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/health`, {
      headers: { 'x-request-id': 'test-request-1' },
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-request-id'), 'test-request-1');
    assert.deepEqual(
      records.map((record) => record.msg),
      ['request_start', 'request_done'],
    );
    assert.deepEqual(
      records.map((record) => record.requestId),
      ['test-request-1', 'test-request-1'],
    );
    assert.equal(records[1].route, '/health');
    assert.equal(records[1].statusCode, 200);
    assert.equal(typeof records[1].ms, 'number');
  } finally {
    await close(server);
  }
});

test('emits chatbot analytics for service answers and unanswered handoffs', async () => {
  const analytics = [];
  const server = createServer({
    verifyToken: 'secret',
    services: [
      {
        id: 'custom-service',
        service_name: 'Custom Published Service',
        description: 'A service loaded from the caller.',
        audience: 'internal',
        office_or_unit: 'International Office',
        classification: 'Simple',
        who_may_avail: 'SLSU internal unit/office',
        requirements: ['Request letter'],
        submission_timeline: ['Send documents to ICO'],
        official_link: 'https://slsu.edu.ph',
        fees: 'None',
        processing_time: '1 day',
        css_reminder: 'Please answer the CSS form.',
      },
    ],
    trackAnalytics(event) {
      analytics.push(event);
    },
    sendMessage: async () => {},
  });
  const baseUrl = await listen(server);

  async function sendText(senderId, text) {
    return fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': `request-${senderId}` },
      body: JSON.stringify({
        object: 'page',
        entry: [{ messaging: [{ sender: { id: senderId }, message: { text } }] }],
      }),
    });
  }

  try {
    assert.equal((await sendText('user-1', 'custom')).status, 200);
    assert.equal((await sendText('user-2', 'not in the charter')).status, 200);

    assert.deepEqual(
      analytics.map((event) => event.name),
      ['chatbot_service_answered', 'chatbot_handoff', 'chatbot_unanswered_question'],
    );
    assert.equal(analytics[0].serviceId, 'custom-service');
    assert.equal(analytics[0].requestId, 'request-user-1');
    assert.equal(analytics[1].reason, 'unanswered');
    assert.equal(analytics[2].question, 'not in the charter');
  } finally {
    await close(server);
  }
});

test('handles Messenger POST events with injected services', async () => {
  const sent = [];
  const server = createServer({
    verifyToken: 'secret',
    services: [
      {
        id: 'custom-service',
        service_name: 'Custom Published Service',
        description: 'A service loaded from the caller.',
        audience: 'internal',
        office_or_unit: 'International Office',
        classification: 'Simple',
        who_may_avail: 'SLSU internal unit/office',
        requirements: ['Request letter'],
        submission_timeline: ['Send documents to ICO'],
        official_link: 'https://slsu.edu.ph',
        fees: 'None',
        processing_time: '1 day',
        css_reminder: 'Please answer the CSS form.',
      },
    ],
    sendMessage: async (recipientId, reply) => {
      sent.push({ recipientId, reply });
    },
  });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        object: 'page',
        entry: [
          {
            messaging: [
              {
                sender: { id: 'user-1' },
                message: { text: 'internal' },
              },
            ],
          },
        ],
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'EVENT_RECEIVED');
    assert.equal(sent.length, 1);
    assert.match(sent[0].reply.text, /Custom Published Service/);
  } finally {
    await close(server);
  }
});

test('loads published services for each Messenger event so Redis invalidation can refresh data', async () => {
  const sent = [];
  let serviceQueryCount = 0;
  let faqQueryCount = 0;
  const redis = {
    async get() {
      return null;
    },
    async set() {
      return 'OK';
    },
  };
  const pool = {
    async query(text, params = []) {
      if (params[0] === 'faq') {
        faqQueryCount += 1;
        return { rows: [] };
      }

      serviceQueryCount += 1;
      return {
        rows: [
          {
            structured_payload: {
              id: `dynamic-service-${serviceQueryCount}`,
              service_name: `Dynamic Service ${serviceQueryCount}`,
              description: 'A service loaded from PostgreSQL.',
              audience: 'internal',
              office_or_unit: 'International Office',
              classification: 'Simple',
              who_may_avail: 'SLSU internal unit/office',
              requirements: ['Request letter'],
              submission_timeline: ['Send documents to ICO'],
              official_link: 'https://slsu.edu.ph',
              fees: 'None',
              processing_time: '1 day',
              css_reminder: 'Please answer the CSS form.',
            },
          },
        ],
      };
    },
  };
  const server = createServer({
    verifyToken: 'secret',
    pool,
    redis,
    sendMessage: async (recipientId, reply) => {
      sent.push({ recipientId, reply });
    },
  });
  const baseUrl = await listen(server);

  async function sendInternal(senderId) {
    return fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        object: 'page',
        entry: [{ messaging: [{ sender: { id: senderId }, message: { text: 'internal' } }] }],
      }),
    });
  }

  try {
    assert.equal((await sendInternal('user-1')).status, 200);
    assert.equal((await sendInternal('user-2')).status, 200);

    assert.equal(serviceQueryCount, 2);
    assert.equal(faqQueryCount, 2);
    assert.match(sent[0].reply.text, /Dynamic Service 1/);
    assert.match(sent[1].reply.text, /Dynamic Service 2/);
  } finally {
    await close(server);
  }
});

test('loads published FAQs for Messenger events', async () => {
  const sent = [];
  const queryTypes = [];
  const redis = {
    async get() {
      return null;
    },
    async set() {
      return 'OK';
    },
  };
  const pool = {
    async query(text, params = []) {
      queryTypes.push(params[0]);
      if (params[0] === 'citizens_charter_service') {
        return { rows: [] };
      }
      if (params[0] === 'faq') {
        return {
          rows: [
            {
              structured_payload: {
                question: 'Where can I get official templates?',
                answer: 'Email reports@slsu.edu.ph for official templates.',
              },
            },
          ],
        };
      }
      throw new Error(`Unexpected content type: ${params[0]}`);
    },
  };
  const server = createServer({
    verifyToken: 'secret',
    pool,
    redis,
    sendMessage: async (recipientId, reply) => {
      sent.push({ recipientId, reply });
    },
  });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        object: 'page',
        entry: [
          { messaging: [{ sender: { id: 'user-1' }, message: { text: 'official templates' } }] },
        ],
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(queryTypes, ['citizens_charter_service', 'faq']);
    assert.equal(sent.length, 1);
    assert.match(sent[0].reply.text, /Where can I get official templates\?/);
    assert.match(sent[0].reply.text, /reports@slsu\.edu\.ph/);
  } finally {
    await close(server);
  }
});

test('does not persist bot sessions in process memory when Redis is unavailable', async () => {
  const sent = [];
  const server = createServer({
    verifyToken: 'secret',
    services: [
      {
        id: 'visa-assistance',
        service_name: 'Visa Assistance',
        description: 'A service loaded from the caller.',
        audience: 'internal',
        office_or_unit: 'International Office',
        classification: 'Simple',
        who_may_avail: 'SLSU internal unit/office',
        requirements: ['Request letter'],
        submission_timeline: ['Send documents to ICO'],
        official_link: 'https://slsu.edu.ph',
        fees: 'None',
        processing_time: '1 day',
        css_reminder: 'Please answer the CSS form.',
      },
    ],
    sendMessage: async (recipientId, reply) => {
      sent.push({ recipientId, reply });
    },
  });
  const baseUrl = await listen(server);

  async function sendText(senderId, text) {
    return fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        object: 'page',
        entry: [{ messaging: [{ sender: { id: senderId }, message: { text } }] }],
      }),
    });
  }

  try {
    assert.equal((await sendText('user-1', 'visa')).status, 200);
    assert.equal((await sendText('user-1', 'BACK_TO_SERVICES')).status, 200);

    assert.match(sent[0].reply.text, /Visa Assistance/);
    assert.match(sent[1].reply.text, /I can only confirm details listed/);
  } finally {
    await close(server);
  }
});

test('startServer rejects default Messenger verify token in production', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalVerifyToken = process.env.MESSENGER_VERIFY_TOKEN;

  try {
    process.env.NODE_ENV = 'production';
    delete process.env.MESSENGER_VERIFY_TOKEN;

    assert.throws(() => startServer(), /MESSENGER_VERIFY_TOKEN must be set in production/);
  } finally {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }

    if (originalVerifyToken === undefined) {
      delete process.env.MESSENGER_VERIFY_TOKEN;
    } else {
      process.env.MESSENGER_VERIFY_TOKEN = originalVerifyToken;
    }
  }
});

test('createServer requires a Messenger app secret in production', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  try {
    process.env.NODE_ENV = 'production';
    assert.throws(
      () => createServer({ verifyToken: 'verify-token', sendMessage: async () => {} }),
      /MESSENGER_APP_SECRET must be set in production/,
    );
  } finally {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  }
});

test('returns 404 for unknown paths', async () => {
  const server = createServer({ verifyToken: 'secret', sendMessage: async () => {} });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/missing`);

    assert.equal(response.status, 404);
  } finally {
    await close(server);
  }
});
