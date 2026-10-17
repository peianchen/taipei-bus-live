import assert from 'node:assert/strict';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { prepareJson, prepareStaleSnapshot, selectJsonPayload } from '../src/json-response.mjs';

test('相同一秒資料可讓多位訪客共用已序列化與壓縮的內容', () => {
  const body = { buses: Array.from({ length: 100 }, (_, index) => ({ id: index, route: '承德幹線' })) };
  const prepared = prepareJson(body);
  const first = selectJsonPayload(prepared, 'gzip');
  const second = selectJsonPayload(prepared, 'gzip');
  assert.equal(first.buffer, second.buffer);
  assert.deepEqual(JSON.parse(gunzipSync(first.buffer).toString('utf8')), body);
  assert.equal(selectJsonPayload(prepared, '').buffer, prepared.plain);
});

test('抓取失敗時舊車況保留，並標記新檢查時間與上游故障', () => {
  const previous = prepareJson({ schemaVersion: 1, snapshotAt: '2026-09-28T14:00:00.000Z', checkedAt: '2026-09-28T14:00:01.000Z', buses: [{ id: 'BUS-1' }] });
  const prepared = prepareStaleSnapshot(previous, Date.parse('2026-09-28T14:00:10.000Z'));
  const body = JSON.parse(prepared.plain.toString('utf8'));
  assert.equal(body.upstreamStale, true);
  assert.equal(body.checkedAt, '2026-09-28T14:00:10.000Z');
  assert.deepEqual(body.buses, [{ id: 'BUS-1' }]);
});
