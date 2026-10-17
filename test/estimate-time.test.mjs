import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEstimateSnapshot, estimatesForRoute } from '../src/estimate-time.mjs';

test('官方到站資料只保留有效秒數並依主路線查詢', () => {
  const snapshot = buildEstimateSnapshot({
    EssentialInfo: { UpdateTime: '2026-10-17 12:34:56' },
    BusInfo: [
      { RouteID: 101, StopID: 1, EstimateTime: '180' },
      { RouteID: 101, StopID: 2, EstimateTime: '-4' },
      { RouteID: 101, StopID: 3, EstimateTime: '-9' },
      { RouteID: 101, StopID: 5, EstimateTime: null },
      { RouteID: 102, StopID: 4, EstimateTime: '0' },
    ],
  }, Date.parse('2026-10-17T04:35:00Z'));
  assert.equal(snapshot.snapshotAt, '2026-10-17T04:34:56.000Z');
  assert.deepEqual(estimatesForRoute(snapshot, '101'), [
    { stopId: '1', seconds: 180 },
    { stopId: '2', seconds: -4 },
  ]);
  assert.deepEqual(estimatesForRoute(snapshot, '999'), []);
});
