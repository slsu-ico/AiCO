const { createHmac, createHash, timingSafeEqual } = require('node:crypto');

function equalSecret(a, b) {
  const left = Buffer.from(a || '');
  const right = Buffer.from(b || '');
  return left.length === right.length && timingSafeEqual(left, right);
}

function extractEvents(body, pageId) {
  if (body?.object !== 'page' || !Array.isArray(body.entry)) return [];
  const events = [];
  for (const entry of body.entry) {
    if (entry?.id !== pageId || !Array.isArray(entry.messaging)) continue;
    for (const event of entry.messaging) {
      if (
        event?.recipient?.id !== pageId ||
        typeof event.sender?.id !== 'string' ||
        !/^\d{1,30}$/.test(event.sender.id) ||
        event.sender.id === pageId ||
        event.message?.is_echo
      ) {
        continue;
      }
      const id =
        event.message?.mid ||
        event.postback?.mid ||
        (typeof event.postback?.payload === 'string' && Number.isSafeInteger(event.timestamp)
          ? 'postback-' +
            createHash('sha256')
              .update(
                JSON.stringify([pageId, event.sender.id, event.timestamp, event.postback.payload]),
              )
              .digest('hex')
          : null);
      const message =
        event.message?.quick_reply?.payload ?? event.postback?.payload ?? event.message?.text;
      if (
        typeof id !== 'string' ||
        id.length > 256 ||
        !id ||
        typeof message !== 'string' ||
        !message.trim() ||
        message.length > 2000 ||
        !Number.isSafeInteger(event.timestamp) ||
        event.timestamp < 0
      ) {
        continue;
      }
      events.push({ id, senderId: event.sender.id, message, timestamp: event.timestamp });
    }
  }
  return events;
}

function createWebhook({ config, enqueue, isReady = async () => true }) {
  return async (request, response) => {
    const send = (status, text) => {
      response.writeHead(status, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end(text);
    };
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/health' && request.method === 'GET') {
      try {
        const ready = await isReady();
        return send(ready ? 200 : 503, ready ? 'ok' : 'unavailable');
      } catch {
        return send(503, 'unavailable');
      }
    }
    if (url.pathname !== '/webhook') return send(404, 'Not found');
    if (request.method === 'GET') {
      if (
        url.searchParams.get('hub.mode') !== 'subscribe' ||
        !equalSecret(url.searchParams.get('hub.verify_token'), config.verifyToken) ||
        !url.searchParams.has('hub.challenge')
      ) {
        return send(403, 'Forbidden');
      }
      return send(200, url.searchParams.get('hub.challenge'));
    }
    if (request.method !== 'POST') return send(405, 'Method not allowed');
    let raw;
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > config.maxBodyBytes) {
          send(413, 'Payload too large');
          return;
        }
        chunks.push(chunk);
      }
      raw = Buffer.concat(chunks);
    } catch {
      return send(400, 'Invalid request body');
    }
    const signature = request.headers['x-hub-signature-256'];
    const expected = 'sha256=' + createHmac('sha256', config.appSecret).update(raw).digest('hex');
    if (
      typeof signature !== 'string' ||
      !/^sha256=[a-f0-9]{64}$/.test(signature) ||
      !equalSecret(signature, expected)
    ) {
      return send(403, 'Forbidden');
    }
    let body;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      return send(400, 'Invalid JSON');
    }
    const events = extractEvents(body, config.pageId);
    try {
      if (events.length) await enqueue(events);
    } catch {
      return send(503, 'Queue unavailable; retry later');
    }
    return send(200, 'EVENT_RECEIVED');
  };
}
module.exports = { createWebhook, extractEvents };
