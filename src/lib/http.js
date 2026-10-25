import { sleep } from './util.js';

const abortError = () => new DOMException('Aborted', 'AbortError');

// Serialises tasks and keeps at least `minGapMs` between their starts.
export function createLimiter(minGapMs) {
  let last = 0;
  let chain = Promise.resolve();
  return function schedule(task, signal) {
    const run = chain.then(async () => {
      if (signal?.aborted) throw abortError();
      const wait = last + minGapMs - Date.now();
      if (wait > 0) await sleep(wait);
      if (signal?.aborted) throw abortError();
      last = Date.now();
      return task();
    });
    chain = run.catch(() => {});
    return run;
  };
}
