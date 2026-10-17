const finite = value => {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const keyFor = (routeId, direction) => `${routeId}:${direction}`;
const MAX_SUBROUTE_STOP_DISTANCE_METERS = 150;

function distanceToShapeMeters(stop, shape) {
  const longitudeMeters = 111_320 * Math.cos(stop.lat * Math.PI / 180);
  let nearest = Infinity;
  for (let index = 1; index < shape.length; index += 1) {
    const first = shape[index - 1];
    const second = shape[index];
    const x = (first[0] - stop.lon) * longitudeMeters;
    const y = (first[1] - stop.lat) * 111_320;
    const dx = (second[0] - first[0]) * longitudeMeters;
    const dy = (second[1] - first[1]) * 111_320;
    const fraction = Math.max(0, Math.min(1, -(x * dx + y * dy) / (dx * dx + dy * dy || 1)));
    nearest = Math.min(nearest, Math.hypot(x + fraction * dx, y + fraction * dy));
  }
  return nearest;
}

export function buildRouteStopIndex(rows = []) {
  const index = new Map();
  for (const row of rows) {
    const routeId = String(row?.routeId ?? '').trim();
    const direction = Number(row?.goBack);
    const sequence = finite(row?.seqNo);
    const lon = finite(row?.showLon) ?? finite(row?.longitude);
    const lat = finite(row?.showLat) ?? finite(row?.latitude);
    const name = String(row?.nameZh || row?.nameEn || '').trim();
    if (!routeId || (direction !== 0 && direction !== 1) || sequence == null ||
        lon == null || lat == null || !name || lat < 21 || lat > 26.5 || lon < 119 || lon > 123) continue;
    const key = keyFor(routeId, direction);
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({
      id: String(row.Id ?? `${routeId}-${direction}-${sequence}`),
      name,
      sequence,
      lon,
      lat,
      bearing: String(row.bearing || ''),
      address: String(row.address || ''),
    });
  }
  for (const stops of index.values()) stops.sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));
  return index;
}

export function buildPathDetailIndex(rows = []) {
  const index = new Map();
  for (const row of rows) {
    const pathId = String(row?.pathAttributeId ?? '').trim();
    const stopId = String(row?.stopId ?? '').trim();
    const sequence = finite(row?.sequenceNo);
    if (!pathId || !stopId || sequence == null || String(row?.type ?? '0') !== '0') continue;
    if (!index.has(pathId)) index.set(pathId, new Map());
    const stops = index.get(pathId);
    if (!stops.has(stopId) || sequence < stops.get(stopId)) stops.set(stopId, sequence);
  }
  return index;
}

export function routeStops(index, routeId, direction, { subRouteId = null, shape = [], mainShape = [], pathIndex = null } = {}) {
  const stops = index.get(keyFor(String(routeId), Number(direction))) || [];
  if (subRouteId == null) return stops;
  const officialPath = pathIndex?.get(String(subRouteId));
  if (officialPath) {
    // GetPathDetail provides exact branch membership and order. It avoids
    // accidentally including a nearby stop belonging to another branch.
    const exactStops = stops.filter(stop => officialPath.has(stop.id))
      .sort((a, b) => officialPath.get(a.id) - officialPath.get(b.id) || a.id.localeCompare(b.id));
    if (exactStops.length) return exactStops;
  }
  if (shape.length < 2) return stops;
  if (mainShape.length === shape.length && mainShape.every((point, index) =>
    point[0] === shape[index][0] && point[1] === shape[index][1])) return stops;
  // GetStop groups stops by the parent route, not by SubRouteID. Keep only
  // stops near the selected branch, so branch-only buses do not show detours.
  return stops.filter(stop => distanceToShapeMeters(stop, shape) <= MAX_SUBROUTE_STOP_DISTANCE_METERS);
}
