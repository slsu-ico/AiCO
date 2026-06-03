const assert = require('node:assert/strict');
const test = require('node:test');

const { createServer, startServer } = require('../src/server');

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

test('returns liveness details for health probes', async () => {
  const server = createServer({ verifyToken: 'secret', sendMessage: async () => {} });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'ico-services-messenger-chatbot');
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
