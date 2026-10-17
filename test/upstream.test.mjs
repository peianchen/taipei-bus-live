import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchUpstream } from '../src/upstream.mjs';

test('上游抓取設定逾時，避免一次請求永遠卡住所有訪客', async () => {
  let signal;
  await fetchUpstream('https://example.invalid/data', {
    timeoutMs: 10,
    fetchImpl: async (_url, options) => {
      signal = options.signal;
      return { ok: true };
    },
  });
  assert.equal(signal.aborted, false);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(signal.aborted, true);
});
