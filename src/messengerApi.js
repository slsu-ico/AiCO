async function sendMessengerMessage(pageAccessToken, recipientId, reply) {
  if (!pageAccessToken) {
    throw new Error('PAGE_ACCESS_TOKEN is required to send Messenger replies.');
  }

  const response = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(pageAccessToken)}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(toMessengerPayload(recipientId, reply)),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Messenger Send API failed with ${response.status}: ${body}`);
  }

  return response.json();
}

function toMessengerPayload(recipientId, reply) {
  const message = {
    text: reply.text,
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
  sendMessengerMessage,
  toMessengerPayload,
};
