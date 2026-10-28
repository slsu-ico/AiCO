const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createHmac } = require('node:crypto');
const { createWebhook } = require('../src/webhook');
const config = {
  pageId: '123456789',
  appSecret: 'test-secret',
  verifyToken: 'test-verify-token',
  maxBodyBytes: 4096,
};

function envelope(overrides = {}) {
  return {
    object: 'page',
    entry: [
      {
        id: '123456789',
        messaging: [
          {
            sender: { id: '987654321' },
            recipient: { id: '123456789' },
            timestamp: 100,
            message: { mid: 'm_1', text: 'hello' },
            ...overrides,
          },
        ],
      },
    ],
  };
}
async function withServer(options, run) {
  const server = http.createServer(
    createWebhook({ config, enqueue: async () => {}, isReady: async () => true, ...options }),
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = async (body, signature) => {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    return fetch(url + '/webhook', {
      method: 'POST',
      body: raw,
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256':
          signature ?? 'sha256=' + createHmac('sha256', config.appSecret).update(raw).digest('hex'),
      },
    });
  };
  try {
    await run({ url, post });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('subscription verification checks mode/token and echoes challenge', async () => {
  await withServer({}, async ({ url }) => {
    const response = await fetch(
      url + '/webhook?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=987',
    );
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '987');
    assert.equal(
      (await fetch(url + '/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=987'))
        .status,
      403,
    );
  });
});

test('valid raw signature enqueues normalized events before acknowledgement', async () => {
  let persisted = false;
  await withServer(
    {
      enqueue: async (events) => {
        assert.deepEqual(events, [
          { id: 'm_1', senderId: '987654321', message: 'hello', timestamp: 100 },
        ]);
        await new Promise((r) => setTimeout(r, 5));
        persisted = true;
      },
    },
    async ({ post }) => {
      assert.equal((await post(envelope())).status, 200);
      assert.equal(persisted, true);
    },
  );
});

test('signature rejection, invalid JSON and oversized payloads never enqueue', async () => {
  let writes = 0;
  await withServer(
    {
      enqueue: async () => {
        writes++;
      },
    },
    async ({ post }) => {
      assert.equal((await post(envelope(), 'sha256=' + '0'.repeat(64))).status, 403);
      assert.equal((await post('{')).status, 400);
      assert.equal((await post('x'.repeat(5000))).status, 413);
      assert.equal(writes, 0);
    },
  );
});

test('mixed-Page batches and recipient spoofing cannot route messages from other Pages', async () => {
  const collected = [];
  await withServer({ enqueue: async (events) => collected.push(...events) }, async ({ post }) => {
    const body = envelope();
    body.entry.push({ ...body.entry[0], id: 'other-page' });
    body.entry[0].messaging.push({
      ...body.entry[0].messaging[0],
      recipient: { id: 'other-page' },
    });
    assert.equal((await post(body)).status, 200);
    assert.equal(collected.length, 1);
    assert.equal(collected[0].senderId, '987654321');
  });
});

test('echoes, receipts, attachments, invalid sender and unsupported objects are ignored', async () => {
  let count = 0;
  await withServer(
    {
      enqueue: async (events) => {
        count += events.length;
      },
    },
    async ({ post }) => {
      for (const change of [
        { message: { mid: 'echo', text: 'echo', is_echo: true } },
        { message: undefined, delivery: { mids: ['m_1'] } },
        { message: { mid: 'attach', attachments: [{}] } },
        { sender: { id: 'not-an-id' } },
        { sender: { id: '123456789' } },
        { message: { text: 'missing stable id' } },
      ]) {
        assert.equal((await post(envelope(change))).status, 200);
      }
      assert.equal((await post({ object: 'instagram', entry: [] })).status, 200);
      assert.equal(count, 0);
    },
  );
});

test('quick reply and postback events use stable event IDs and payloads', async () => {
  const collected = [];
  await withServer({ enqueue: async (events) => collected.push(...events) }, async ({ post }) => {
    await post(
      envelope({
        message: {
          mid: 'quick',
          text: 'Writing',
          quick_reply: { payload: 'SERVICE_internal-writing-request' },
        },
      }),
    );
    await post(
      envelope({ message: undefined, postback: { mid: 'postback', payload: 'GET_STARTED' } }),
    );
    assert.deepEqual(
      collected.map((e) => [e.id, e.message]),
      [
        ['quick', 'SERVICE_internal-writing-request'],
        ['postback', 'GET_STARTED'],
      ],
    );
  });
});

test('durable queue failure returns retryable response without leaking details', async () => {
  await withServer(
    {
      enqueue: async () => {
        throw new Error('redis://private:secret@host');
      },
    },
    async ({ post }) => {
      const response = await post(envelope());
      assert.equal(response.status, 503);
      assert.doesNotMatch(await response.text(), /private|secret/);
    },
  );
});

test('Get Started postbacks without mid use a repeatable timestamp-based ID', async () => {
  const collected = [];
  await withServer({ enqueue: async (events) => collected.push(...events) }, async ({ post }) => {
    const event = envelope({ message: undefined, postback: { payload: 'GET_STARTED' } });
    await post(event);
    await post(event);
    event.entry[0].messaging[0].timestamp = 101;
    await post(event);
    assert.equal(collected.length, 3);
    assert.equal(collected[0].id, collected[1].id);
    assert.notEqual(collected[0].id, collected[2].id);
    assert.equal(collected[0].message, 'GET_STARTED');
  });
});

test('only webhook and health routes exist, and health reflects dependencies', async () => {
  await withServer({ isReady: async () => false }, async ({ url }) => {
    assert.equal((await fetch(url + '/health')).status, 503);
    assert.equal((await fetch(url + '/')).status, 404);
    assert.equal((await fetch(url + '/admin')).status, 404);
  });
});
