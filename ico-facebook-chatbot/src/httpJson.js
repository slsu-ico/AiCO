async function readJson(response, limit = 16384) {
  if (Number(response.headers.get('content-length')) > limit) {
    throw new Error('Upstream response too large.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body || []) {
    size += chunk.byteLength;
    if (size > limit) throw new Error('Upstream response too large.');
    chunks.push(Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('Invalid upstream JSON.');
  }
}
module.exports = { readJson };
