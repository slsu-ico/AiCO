const DEFAULT_MESSENGER_TIMEOUT_MS = 10000;
const MESSENGER_TEXT_MAX_LENGTH = 2000;

function splitMessengerText(value, maxLength = MESSENGER_TEXT_MAX_LENGTH) {
  const remaining = Array.from(String(value ?? ''));
  const chunks = [];

  while (remaining.length > maxLength) {
    let splitAt = maxLength;
    for (let index = maxLength - 1; index >= Math.floor(maxLength / 2); index -= 1) {
      if (/\s/.test(remaining[index])) {
        splitAt = index + 1;
        break;
      }
    }

    const chunk = remaining.splice(0, splitAt).join('').trimEnd();
    while (remaining.length > 0 && /\s/.test(remaining[0])) remaining.shift();
    if (chunk) chunks.push(chunk);
  }

  const finalChunk = remaining.join('').trim();
  if (finalChunk || chunks.length === 0) chunks.push(finalChunk);
  return chunks;
}

async function sendMessengerMessage(pageAccessToken, recipientId, reply, options = {}) {
  if (!pageAccessToken) {
    throw new Error('PAGE_ACCESS_TOKEN is required to send Messenger replies.');
  }

  const fetchImpl = options.fetchImpl || fetch;
  const chunks = splitMessengerText(reply.text);
  let result;

  for (let index = 0; index < chunks.length; index += 1) {
    const chunkReply = {
      text: chunks[index],
      ...(index === chunks.length - 1 && reply.quickReplies
        ? { quickReplies: reply.quickReplies }
        : {}),
    };
    const signal =
      options.signal ||
      globalThis.AbortSignal.timeout(options.timeoutMs || DEFAULT_MESSENGER_TIMEOUT_MS);
    const response = await fetchImpl('https://graph.facebook.com/v21.0/me/messages', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${pageAccessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(toMessengerPayload(recipientId, chunkReply)),
      signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Messenger Send API failed with ${response.status}: ${body}`);
    }

    result = await response.json();
  }

  return result;
}

function toMessengerPayload(recipientId, reply) {
  if (Array.from(String(reply.text ?? '')).length > MESSENGER_TEXT_MAX_LENGTH) {
    throw new RangeError(`Messenger text must not exceed ${MESSENGER_TEXT_MAX_LENGTH} characters.`);
  }
  const message = {
    text: String(reply.text ?? ''),
  };

  if (reply.quickReplies && reply.quickReplies.length > 0) {
    message.quick_replies = reply.quickReplies.slice(0, 13).map((item) => ({
      content_type: 'text',
      title: item.title.slice(0, 20),
      payload: item.payload,
    }));
  }

  return {
    recipient: {
      id: recipientId,
    },
    messaging_type: 'RESPONSE',
    message,
  };
}

module.exports = {
  DEFAULT_MESSENGER_TIMEOUT_MS,
  MESSENGER_TEXT_MAX_LENGTH,
  sendMessengerMessage,
  splitMessengerText,
  toMessengerPayload,
};
