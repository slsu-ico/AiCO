const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MESSENGER_TEXT_MAX_LENGTH,
  sendMessengerMessage,
  splitMessengerText,
  toMessengerPayload,
} = require('../src/messengerApi');

test('toMessengerPayload maps text and bounded quick replies', () => {
  const quickReplies = Array.from({ length: 15 }, (_, index) => ({
    title: `A quick reply title ${index}`,
    payload: `CHOICE_${index}`,
  }));

  const payload = toMessengerPayload('recipient-1', { text: 'Hello', quickReplies });

  assert.equal(payload.recipient.id, 'recipient-1');
  assert.equal(payload.message.text, 'Hello');
  assert.equal(payload.message.quick_replies.length, 13);
  assert.ok(payload.message.quick_replies.every((reply) => reply.title.length <= 20));
});

test('sendMessengerMessage keeps the page token out of the URL and uses bearer auth', async () => {
  const calls = [];
  const result = await sendMessengerMessage(
    'page-secret',
    'recipient-1',
    { text: 'Hello' },
    {
      signal: globalThis.AbortSignal.abort(),
      async fetchImpl(url, options) {
        calls.push({ url, options });
        return {
          ok: true,
          async json() {
            return { message_id: 'message-1' };
          },
        };
      },
    },
  );

  assert.deepEqual(result, { message_id: 'message-1' });
  assert.equal(calls[0].url, 'https://graph.facebook.com/v21.0/me/messages');
  assert.equal(calls[0].options.headers.authorization, 'Bearer page-secret');
  assert.doesNotMatch(calls[0].url, /page-secret/);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    recipient: { id: 'recipient-1' },
    messaging_type: 'RESPONSE',
    message: { text: 'Hello' },
  });
});

test('sendMessengerMessage reports a failed Graph API response', async () => {
  await assert.rejects(
    sendMessengerMessage(
      'page-secret',
      'recipient-1',
      { text: 'Hello' },
      {
        async fetchImpl() {
          return {
            ok: false,
            status: 429,
            async text() {
              return 'rate limited';
            },
          };
        },
      },
    ),
    /failed with 429: rate limited/,
  );
});

test('sendMessengerMessage splits long text and puts quick replies on the final chunk', async () => {
  const calls = [];
  await sendMessengerMessage(
    'page-secret',
    'recipient-1',
    {
      text: `Intro\n${'service detail '.repeat(350)}`,
      quickReplies: [{ title: 'Back', payload: 'BACK' }],
    },
    {
      async fetchImpl(url, options) {
        calls.push({ url, options });
        return {
          ok: true,
          async json() {
            return { message_id: `message-${calls.length}` };
          },
        };
      },
    },
  );

  assert.ok(calls.length > 1);
  const payloads = calls.map((call) => JSON.parse(call.options.body));
  assert.ok(
    payloads.every(
      (payload) => Array.from(payload.message.text).length <= MESSENGER_TEXT_MAX_LENGTH,
    ),
  );
  assert.ok(payloads.slice(0, -1).every((payload) => !payload.message.quick_replies));
  assert.equal(payloads.at(-1).message.quick_replies[0].payload, 'BACK');
  assert.equal(new Set(calls.map((call) => call.options.signal)).size, calls.length);
});

test('splitMessengerText preserves all non-whitespace content within bounded chunks', () => {
  const source = `one ${'two '.repeat(1200)}three`;
  const chunks = splitMessengerText(source);

  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => Array.from(chunk).length <= MESSENGER_TEXT_MAX_LENGTH));
  assert.equal(chunks.join(' ').replace(/\s+/g, ' '), source.replace(/\s+/g, ' '));
});
