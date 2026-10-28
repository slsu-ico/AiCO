const { setTimeout: delay } = require('node:timers/promises');
const { splitReplies } = require('./messenger');

function createProcessor({ conversation, send, getSession, saveSession, sleep = delay }) {
  return async (job) => {
    // Stay within Messenger's standard response window; never send queued old replies.
    if (Date.now() - job.data.timestamp > 23 * 3600 * 1000) return;
    let data = { ...job.data };
    for (let attempt = data.attempts || 0; attempt < 3; attempt++) {
      data = { ...data, attempts: attempt + 1 };
      await job.updateData(data);
      try {
        if (!data.prepared) {
          const result = await conversation(await getSession(data.senderId), data.message);
          data = {
            ...data,
            prepared: { session: result.session, replies: splitReplies(result.replies) },
            nextReply: 0,
          };
          await job.updateData(data);
        }
        for (let index = data.nextReply || 0; index < data.prepared.replies.length; index++) {
          if (Date.now() - data.timestamp > 23 * 3600 * 1000) return;
          await send(data.senderId, data.prepared.replies[index]);
          data = { ...data, nextReply: index + 1 };
          await job.updateData(data);
        }
        await saveSession(data.senderId, data.prepared.session);
        return;
      } catch {
        if (attempt < 2) await sleep(250 * 2 ** attempt);
      }
    }
    throw new Error('Message delivery failed after bounded retries.');
  };
}
module.exports = { createProcessor };
