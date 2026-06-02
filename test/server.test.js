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
    const response = await fetch(`${baseUrl}/webhook?hub.mode=subscribe&hub.verify_token=secret&hub.challenge=abc123`);
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
    const response = await fetch(`${baseUrl}/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123`);
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

test('handles Messenger POST events with injected services', async () => {
  const sent = [];
  const server = createServer({
    verifyToken: 'secret',
    services: [{
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
    }],
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
  let queryCount = 0;
  const redis = {
    async get() {
      return null;
    },
    async set() {
      return 'OK';
    },
  };
  const pool = {
    async query() {
      queryCount += 1;
      return {
        rows: [{
          structured_payload: {
            id: `dynamic-service-${queryCount}`,
            service_name: `Dynamic Service ${queryCount}`,
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
        }],
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

    assert.equal(queryCount, 2);
    assert.match(sent[0].reply.text, /Dynamic Service 1/);
    assert.match(sent[1].reply.text, /Dynamic Service 2/);
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
