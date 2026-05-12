const assert = require('node:assert/strict');
const test = require('node:test');

const { createServer } = require('../src/server');

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

  const response = await fetch(`${baseUrl}/webhook?hub.mode=subscribe&hub.verify_token=secret&hub.challenge=abc123`);
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.equal(body, 'abc123');

  await close(server);
});

test('rejects Messenger webhook verification with the wrong token', async () => {
  const server = createServer({ verifyToken: 'secret', sendMessage: async () => {} });
  const baseUrl = await listen(server);

  const response = await fetch(`${baseUrl}/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123`);
  const body = await response.text();

  assert.equal(response.status, 403);
  assert.equal(body, 'Forbidden');

  await close(server);
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
  assert.match(sent[0].reply.text, /SLSU internal unit\/office/i);

  await close(server);
});

test('returns 404 for unknown paths', async () => {
  const server = createServer({ verifyToken: 'secret', sendMessage: async () => {} });
  const baseUrl = await listen(server);

  const response = await fetch(`${baseUrl}/missing`);

  assert.equal(response.status, 404);

  await close(server);
});
