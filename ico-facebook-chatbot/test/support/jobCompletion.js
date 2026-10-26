function waitForJobs(worker, ids, timeoutMs = 10000) {
  const pending = new Set(ids);
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      worker.off('completed', completed);
      worker.off('failed', failed);
    };
    const completed = (job) => {
      pending.delete(job.data.id);
      if (!pending.size) {
        cleanup();
        resolve();
      }
    };
    const failed = (job) => {
      if (pending.has(job?.data.id)) {
        cleanup();
        reject(new Error('Expected job failed.'));
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Expected jobs did not complete.'));
    }, timeoutMs);
    worker.on('completed', completed);
    worker.on('failed', failed);
  });
}
module.exports = { waitForJobs };
