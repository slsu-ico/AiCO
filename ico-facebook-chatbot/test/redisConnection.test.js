const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { createRedisConnection } = require('../src/runtime');

test(
  'producer Redis reconnects after an outage exceeding three reconnect attempts',
  { timeout: 10000 },
  async () => {
    const sockets = new Set();
    // This TCP fixture acknowledges Redis startup commands and PING. It tests our
    // reconnect policy; durable queue semantics are covered by real Redis tests.
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      let pending = '';
      socket.on('data', (chunk) => {
        pending += chunk.toString();
        while (pending.startsWith('*')) {
          const lines = pending.split('\r\n');
          const count = Number(lines[0].slice(1));
          if (lines.length < count * 2 + 2) break;
          const consumed = lines.slice(0, count * 2 + 1).join('\r\n').length + 2;
          pending = pending.slice(consumed);
          socket.write('+PONG\r\n');
        }
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    let redis;
    let timer;
    let deadline;
    try {
      redis = createRedisConnection({ redisUrl: `redis://127.0.0.1:${port}` });
      await redis.connect();
      const reconnected = new Promise((resolve, reject) => {
        redis.once('ready', resolve);
        deadline = setTimeout(
          () => reject(new Error('Producer did not reconnect after outage')),
          4000,
        );
      });
      await new Promise((resolve) => {
        server.close(resolve);
        for (const socket of sockets) socket.destroy();
      });
      timer = setTimeout(() => server.listen(port, '127.0.0.1'), 1200);
      await reconnected;
      assert.equal(await redis.ping(), 'PONG');
    } finally {
      clearTimeout(timer);
      clearTimeout(deadline);
      redis?.disconnect();
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
