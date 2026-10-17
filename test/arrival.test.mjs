import assert from 'node:assert/strict';
import test from 'node:test';
import { describeArrival } from '../public/arrival.mjs';

test('到站秒數與官方特殊狀態分開呈現', () => {
  assert.equal(describeArrival(0), '即將進站');
  assert.equal(describeArrival(61), '約 2 分鐘');
  assert.equal(describeArrival(-1), '尚未發車');
  assert.equal(describeArrival(-2), '交管不停靠');
  assert.equal(describeArrival(-3), '末班車已過');
  assert.equal(describeArrival(-4), '今日未營運');
  assert.equal(describeArrival(undefined), '目前無預估');
});
