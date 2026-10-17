const EARTH_RADIUS_METERS = 6_371_008.8;

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

function pathDistanceMeters(first, second) {
  const latitude = (first[1] + second[1]) / 2 * Math.PI / 180;
  const x = (second[0] - first[0]) * 111_320 * Math.cos(latitude);
  const y = (second[1] - first[1]) * 111_320;
  return Math.hypot(x, y);
}

function coordinateAlongPath(path, fraction) {
  const lengths = [];
  let total = 0;
  for (let index = 0; index < path.length - 1; index += 1) {
    const length = pathDistanceMeters(path[index], path[index + 1]);
    lengths.push(length);
    total += length;
  }
  if (!total) return [...path[0]];
  let remaining = total * clamp(fraction, 0, 1);
  for (let index = 0; index < lengths.length; index += 1) {
    if (remaining <= lengths[index] || index === lengths.length - 1) {
      const segmentFraction = lengths[index] ? remaining / lengths[index] : 0;
      return [
        path[index][0] + (path[index + 1][0] - path[index][0]) * segmentFraction,
        path[index][1] + (path[index + 1][1] - path[index][1]) * segmentFraction,
      ];
    }
    remaining -= lengths[index];
  }
  return [...path.at(-1)];
}

export function predictBusCoordinate(bus, atMs, {
  minimumSpeedKph = 3,
  maximumSpeedKph = 80,
  maximumExtrapolationSec = 15,
  maximumDistanceMeters = 250,
} = {}) {
  const base = [Number(bus.lon), Number(bus.lat)];
  const updatedMs = Date.parse(bus.estimatedAt || bus.updatedAt);
  const motionPath = Array.isArray(bus.motionPath)
    ? bus.motionPath.filter(point => Array.isArray(point) && point.length >= 2 && point.slice(0, 2).every(Number.isFinite))
    : [];
  const pathUntilMs = Date.parse(bus.motionPathUntil);
  if (bus.motionMode === 'route' && motionPath.length >= 2 &&
      Number.isFinite(updatedMs) && Number.isFinite(pathUntilMs) && pathUntilMs > updatedMs) {
    return coordinateAlongPath(motionPath, (atMs - updatedMs) / (pathUntilMs - updatedMs));
  }
  if (bus.motionMode === 'route') return base;
  const speedKph = Number(bus.motionSpeedKph ?? bus.speed);
  const bearingDegrees = Number(bus.bearing);
  if (!base.every(Number.isFinite) || !Number.isFinite(updatedMs) ||
      !Number.isFinite(speedKph) || speedKph < minimumSpeedKph ||
      !Number.isFinite(bearingDegrees)) return base;

  const elapsedSec = clamp((atMs - updatedMs) / 1000, 0, maximumExtrapolationSec);
  const distanceMeters = Math.min(
    clamp(speedKph, 0, maximumSpeedKph) / 3.6 * elapsedSec,
    maximumDistanceMeters,
  );
  if (distanceMeters <= 0) return base;

  const angularDistance = distanceMeters / EARTH_RADIUS_METERS;
  const bearing = bearingDegrees * Math.PI / 180;
  const latitude = base[1] * Math.PI / 180;
  const longitude = base[0] * Math.PI / 180;
  const targetLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angularDistance) +
    Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const targetLongitude = longitude + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
    Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(targetLatitude),
  );
  return [targetLongitude * 180 / Math.PI, targetLatitude * 180 / Math.PI];
}

export function advanceDisplayedCoordinate(current, bus, atMs, { maximumStepMeters = Infinity } = {}) {
  const target = predictBusCoordinate(bus, atMs);
  return bus?.motionMode === 'route' && Array.isArray(bus.motionPath) && bus.motionPath.length >= 2
    ? target
    : followCoordinate(current, target, { maximumStepMeters });
}

export function followCoordinate(current, target, { maximumStepMeters = Infinity } = {}) {
  if (!current?.every(Number.isFinite)) return [...target];
  // Retarget from the current position on every tick, so a new GPS fix can
  // interrupt an in-progress correction without restarting from the old fix.
  const latitude = (current[1] + target[1]) / 2 * Math.PI / 180;
  const xMeters = (target[0] - current[0]) * 111_320 * Math.cos(latitude);
  const yMeters = (target[1] - current[1]) * 111_320;
  const distanceMeters = Math.hypot(xMeters, yMeters);
  const fraction = distanceMeters
    ? Math.min(0.5, Math.max(0, maximumStepMeters) / distanceMeters)
    : 0;
  return [
    current[0] + (target[0] - current[0]) * fraction,
    current[1] + (target[1] - current[1]) * fraction,
  ];
}

export function stabilizeRouteTarget(previous, next) {
  if (!previous || !next || !previous.routeKey || previous.routeKey !== next.routeKey ||
      !Number.isFinite(previous.routeProgress) || !Number.isFinite(next.routeProgress)) return next;
  if (next.routeProgress >= previous.routeProgress) return next;
  const length = Number(next.routeLength) || Number(previous.routeLength);
  const wrappedAtTerminus = Number.isFinite(length) && length > 0 &&
    previous.routeProgress > length * 0.85 && next.routeProgress < length * 0.15;
  if (wrappedAtTerminus) return next;
  return {
    ...next,
    lon: previous.lon,
    lat: previous.lat,
    bearing: previous.bearing,
    routeProgress: previous.routeProgress,
    ...(next.motionMode === 'route' ? {
      motionPath: [[previous.lon, previous.lat], [previous.lon, previous.lat]],
      motionSpeedKph: 0,
    } : {}),
  };
}
