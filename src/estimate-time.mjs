import { taipeiTimeMs } from './bus-data.mjs';

export function buildEstimateSnapshot(body, checkedAt = Date.now()) {
  const routes = new Map();
  for (const row of body?.BusInfo || []) {
    const routeId = String(row?.RouteID ?? '').trim();
    const stopId = String(row?.StopID ?? '').trim();
    if (row?.EstimateTime == null || String(row.EstimateTime).trim() === '') continue;
    const seconds = Number(row?.EstimateTime);
    if (!routeId || !stopId || !Number.isInteger(seconds) || seconds < -4) continue;
    if (!routes.has(routeId)) routes.set(routeId, new Map());
    routes.get(routeId).set(stopId, seconds);
  }
  const snapshotMs = taipeiTimeMs(body?.EssentialInfo?.UpdateTime);
  return {
    routes,
    snapshotAt: snapshotMs == null ? null : new Date(snapshotMs).toISOString(),
    checkedAt: new Date(checkedAt).toISOString(),
  };
}

export function estimatesForRoute(snapshot, routeId) {
  return [...(snapshot.routes.get(String(routeId)) || new Map())]
    .map(([stopId, seconds]) => ({ stopId, seconds }));
}
