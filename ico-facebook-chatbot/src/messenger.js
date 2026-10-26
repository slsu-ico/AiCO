const { readJson } = require('./httpJson');

function splitReplies(replies) {
  const result = [];
  for (const reply of replies) {
    let text = String(reply.text);
    while (text.length > 1800) {
      let end = 1800;
      if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
      result.push({ text: text.slice(0, end) });
      text = text.slice(end);
    }
    result.push({ text, ...(reply.quickReplies ? { quickReplies: reply.quickReplies } : {}) });
  }
  return result;
}

function createSender(config, { fetchImpl = fetch } = {}) {
  return async (senderId, reply) => {
    if (!/^\d{1,30}$/.test(senderId) || senderId === config.pageId) {
      throw new Error('Invalid Messenger recipient.');
    }
    if (typeof reply.text !== 'string' || !reply.text.length || reply.text.length > 2000) {
      throw new Error('Invalid Messenger text.');
    }
    const message = { text: reply.text };
    if (reply.quickReplies?.length) {
      message.quick_replies = reply.quickReplies
        .slice(0, 13)
        .map((q) => ({ content_type: 'text', title: q.title.slice(0, 20), payload: q.payload }));
    }
    const response = await fetchImpl(
      `https://graph.facebook.com/${config.graphVersion}/${config.pageId}/messages`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.pageAccessToken}`,
          'content-type': 'application/json',
        },
        signal: globalThis.AbortSignal.timeout(config.sendTimeoutMs),
        body: JSON.stringify({ recipient: { id: senderId }, messaging_type: 'RESPONSE', message }),
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Messenger request failed (${response.status}).`);
    }
    const body = await readJson(response);
    if (!body.message_id || body.recipient_id !== senderId) {
      throw new Error('Invalid Messenger acknowledgement.');
    }
  };
}
module.exports = { createSender, splitReplies };
