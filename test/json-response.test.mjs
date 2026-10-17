import assert from 'node:assert/strict';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { prepareJson, selectJsonPayload } from '../src/json-response.mjs';

test('相同一秒資料可讓多位訪客共用已序列化與壓縮的內容', () => {
  const body = { buses: Array.from({ length: 100 }, (_, index) => ({ id: index, route: '承德幹線' })) };
  const prepared = prepareJson(body);
  const first = selectJsonPayload(prepared, 'gzip');
  const second = selectJsonPayload(prepared, 'gzip');
  assert.equal(first.buffer, second.buffer);
  assert.deepEqual(JSON.parse(gunzipSync(first.buffer).toString('utf8')), body);
  assert.equal(selectJsonPayload(prepared, '').buffer, prepared.plain);
});
