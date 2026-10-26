const test = require('node:test');
const assert = require('node:assert/strict');
const { createProcessor } = require('../src/jobs');
const { createConversation } = require('../src/conversation');
const { loadKnowledge } = require('../src/knowledge');
const conversation = createConversation({ services: loadKnowledge() });
function job(data) {
  return {
    data: structuredClone(data),
    async updateData(value) {
      this.data = structuredClone(value);
    },
  };
}

test('processor delivers form guidance and persists selected service session', async () => {
  const sent = [];
  let state;
  const process = createProcessor({
    conversation,
    send: async (id, reply) => sent.push({ id, ...reply }),
    getSession: async () => ({}),
    saveSession: async (id, session) => {
      state = { id, session };
    },
    sleep: async () => {},
  });
  const input = job({
    senderId: '987654321',
    message: 'SERVICE_internal-writing-request',
    timestamp: Date.now(),
  });
  await process(input);
  assert.match(sent.map((r) => r.text).join(''), /forms.gle\/CsJsfxNxSFt4Swo38/);
  assert.equal(state.id, '987654321');
  assert.equal(state.session.lastServiceId, 'internal-writing-request');
  assert.equal(input.data.nextReply, sent.length);
});

test('bounded retries stay in the current processor and resume unsent chunks', async () => {
  const calls = [];
  let failures = 0;
  const process = createProcessor({
    conversation: async () => ({ session: {}, replies: [{ text: 'a'.repeat(2000) }] }),
    getSession: async () => ({}),
    saveSession: async () => {},
    sleep: async () => {},
    send: async (_id, reply) => {
      calls.push(reply.text.length);
      if (reply.text.length === 200 && failures++ === 0) throw new Error('temporary');
    },
  });
  const input = job({ senderId: '987654321', message: 'hello', timestamp: Date.now() });
  await process(input);
  assert.deepEqual(calls, [1800, 200, 200]);
  assert.equal(input.data.nextReply, 2);
});

test('checkpointed answer survives restart without reclassifying or repeating sent chunks', async () => {
  const sent = [];
  const process = createProcessor({
    conversation: async () => {
      throw new Error('must not classify');
    },
    getSession: async () => ({}),
    saveSession: async () => {},
    sleep: async () => {},
    send: async (_id, reply) => sent.push(reply.text),
  });
  await process(
    job({
      senderId: '987654321',
      timestamp: Date.now(),
      prepared: {
        session: { lastServiceId: 'internal-writing-request' },
        replies: [{ text: 'already sent' }, { text: 'remaining' }],
      },
      nextReply: 1,
      attempts: 1,
    }),
  );
  assert.deepEqual(sent, ['remaining']);
});

test('permanently failing send stops after three attempts, including restarted attempts', async () => {
  let attempts = 0;
  const process = createProcessor({
    conversation: async () => ({ session: {}, replies: [{ text: 'reply' }] }),
    getSession: async () => ({}),
    saveSession: async () => {},
    sleep: async () => {},
    send: async () => {
      attempts++;
      throw new Error('private token');
    },
  });
  const input = job({ senderId: '987654321', message: 'hi', timestamp: Date.now() });
  await assert.rejects(process(input), /delivery failed/i);
  assert.equal(attempts, 3);
  await assert.rejects(process(input), /delivery failed/i);
  assert.equal(attempts, 3);
});

test('session-write failure retries state save without repeating sent replies', async () => {
  let sends = 0;
  let saves = 0;
  const process = createProcessor({
    conversation: async () => ({ session: {}, replies: [{ text: 'reply' }] }),
    getSession: async () => ({}),
    send: async () => {
      sends++;
    },
    saveSession: async () => {
      if (saves++ === 0) throw new Error('redis');
    },
    sleep: async () => {},
  });
  await process(job({ senderId: '987654321', message: 'hello', timestamp: Date.now() }));
  assert.equal(sends, 1);
  assert.equal(saves, 2);
});

test('expired queued messages cannot generate replies outside the response window', async () => {
  let sent = false;
  const process = createProcessor({
    conversation,
    getSession: async () => ({}),
    saveSession: async () => {},
    send: async () => {
      sent = true;
    },
    sleep: async () => {},
  });
  await process(
    job({ senderId: '987654321', message: 'hello', timestamp: Date.now() - 25 * 3600 * 1000 }),
  );
  assert.equal(sent, false);
});
