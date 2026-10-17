import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeBusSnapshot, readGzipJson, ROUTE_URL, SHAPE_URL, STOP_URL, VEHICLE_URL } from './src/bus-data.mjs';
import { prepareJson, prepareStaleSnapshot, selectJsonPayload } from './src/json-response.mjs';
import { applyRouteMotion, buildShapeIndex, createRouteMotionModel, routeTrackCoordinates } from './src/route-motion.mjs';
import { buildRouteStopIndex, routeStops } from './src/route-stops.mjs';
import { isVendorFile, resolveStaticFile } from './src/static-files.mjs';
import { fetchUpstream } from './src/upstream.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5180);
const HOST = process.env.HOST || '127.0.0.1';
const CACHE_MS = 1_000;
const ROUTE_CACHE_MS = 6 * 60 * 60 * 1000;
let cache = null;
let inflight = null;
let routeCache = null;
let routeInflight = null;
let shapeCache = null;
let shapeInflight = null;
let stopCache = null;
let stopInflight = null;
let motionModels = new Map();
let modeledSnapshotAt = null;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
};

async function currentRoutes() {
  if (routeCache && Date.now() - routeCache.cachedAt < ROUTE_CACHE_MS) return routeCache.data;
  if (routeInflight) return routeInflight;
  routeInflight = (async () => {
    const response = await fetchUpstream(ROUTE_URL);
    const data = await readGzipJson(response);
    routeCache = { cachedAt: Date.now(), data };
    return data;
  })().finally(() => { routeInflight = null; });
  return routeInflight;
}

async function currentShapeIndex() {
  if (shapeCache && Date.now() - shapeCache.cachedAt < ROUTE_CACHE_MS) return shapeCache.data;
  if (shapeInflight) return shapeInflight;
  shapeInflight = (async () => {
    const response = await fetchUpstream(SHAPE_URL);
    const rows = await readGzipJson(response);
    const data = buildShapeIndex(rows);
    shapeCache = { cachedAt: Date.now(), data };
    return data;
  })().finally(() => { shapeInflight = null; });
  return shapeInflight;
}

async function currentStopIndex() {
  if (stopCache && Date.now() - stopCache.cachedAt < ROUTE_CACHE_MS) return stopCache.data;
  if (stopInflight) return stopInflight;
  stopInflight = (async () => {
    const response = await fetchUpstream(STOP_URL);
    const body = await readGzipJson(response);
    const data = buildRouteStopIndex(body?.BusInfo);
    stopCache = { cachedAt: Date.now(), data };
    return data;
  })().finally(() => { stopInflight = null; });
  return stopInflight;
}

async function currentBuses() {
  if (cache && Date.now() - cache.cachedAt < CACHE_MS) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const [vehicleResponse, routes, shapeIndex] = await Promise.all([
        fetchUpstream(VEHICLE_URL),
        currentRoutes(),
        currentShapeIndex().catch(error => {
          console.warn('路線軌跡暫時無法取得，改用方位推估：', error.message);
          return null;
        }),
      ]);
      const vehicles = await readGzipJson(vehicleResponse);
      const data = normalizeBusSnapshot(vehicles, routes);
      if (shapeIndex && data.snapshotAt !== modeledSnapshotAt) {
        const previousModels = motionModels;
        motionModels = new Map(data.buses.map(bus => [bus.id, createRouteMotionModel(bus, shapeIndex, {
          previousModel: previousModels.get(bus.id),
        })]));
        modeledSnapshotAt = data.snapshotAt;
      }
      const cachedAt = Date.now();
      cache = {
        cachedAt,
        prepared: prepareJson({
          ...data,
          buses: applyRouteMotion(data.buses, motionModels, cachedAt),
          checkedAt: new Date(cachedAt).toISOString(),
        }),
      };
      return cache;
    } catch (error) {
      if (!cache) throw error;
      console.warn('上游車況暫時無法更新，保留上一份車況：', error.message);
      const cachedAt = Date.now();
      cache = { cachedAt, prepared: prepareStaleSnapshot(cache.prepared, cachedAt) };
      return cache;
    }
  })().finally(() => { inflight = null; });
  return inflight;
}

function sendPreparedJson(response, prepared, status = 200, acceptEncoding = '') {
  const { buffer, compressed } = selectJsonPayload(prepared, acceptEncoding);
  response.writeHead(status, {
    'content-type': MIME['.json'],
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'vary': 'accept-encoding',
    ...(compressed ? { 'content-encoding': 'gzip' } : {}),
  });
  response.end(buffer);
}

function sendJson(response, body, status = 200, acceptEncoding = '') {
  sendPreparedJson(response, prepareJson(body), status, acceptEncoding);
}

async function staticFile(pathname, response) {
  const target = resolveStaticFile(ROOT, pathname);
  if (!target) return false;
  try {
    const actualTarget = await realpath(target);
    if (!isVendorFile(pathname)) {
      const publicRoot = await realpath(path.join(ROOT, 'public'));
      if (!actualTarget.startsWith(publicRoot + path.sep)) return false;
    }
    const data = await readFile(actualTarget);
    response.writeHead(200, {
      'content-type': path.extname(target) === '.mjs' ? MIME['.js'] : MIME[path.extname(target)] || 'application/octet-stream',
      'cache-control': isVendorFile(pathname) ? 'public, max-age=86400' : 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    response.end(data);
    return true;
  } catch { return false; }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const routeStopsMatch = /^\/api\/routes\/(\d+)\/stops$/.exec(url.pathname);
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD' }); response.end(); return;
    }
    if (url.pathname === '/api/buses') {
      const current = await currentBuses();
      sendPreparedJson(response, current.prepared, 200, request.headers['accept-encoding']);
      return;
    }
    if (routeStopsMatch) {
      const directionParam = url.searchParams.get('direction');
      if (directionParam !== '0' && directionParam !== '1') {
        sendJson(response, { error: 'direction 必須是 0 或 1。' }, 400, request.headers['accept-encoding']);
        return;
      }
      const direction = Number(directionParam);
      const routeId = routeStopsMatch[1];
      const subRouteId = url.searchParams.get('subRouteId');
      if (subRouteId != null && !/^\d+$/.test(subRouteId)) {
        sendJson(response, { error: 'subRouteId 必須是數字。' }, 400, request.headers['accept-encoding']);
        return;
      }
      const [stopIndex, shapeIndex] = await Promise.all([currentStopIndex(), currentShapeIndex()]);
      const shape = routeTrackCoordinates(shapeIndex, routeId, direction, subRouteId);
      const mainShape = subRouteId == null ? [] : routeTrackCoordinates(shapeIndex, routeId, direction);
      const stops = routeStops(stopIndex, routeId, direction, { subRouteId, shape, mainShape });
      sendJson(response, {
        schemaVersion: 1,
        routeId,
        direction,
        stops,
        shape,
      }, stops.length || shape.length ? 200 : 404, request.headers['accept-encoding']);
      return;
    }
    if (url.pathname === '/api/health') {
      sendJson(response, { ok: true, cached: !!cache, ageMs: cache ? Date.now() - cache.cachedAt : null }, 200, request.headers['accept-encoding']);
      return;
    }
    if (await staticFile(decodeURIComponent(url.pathname), response)) return;
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); response.end('Not found');
  } catch (error) {
    console.error(error);
    sendJson(response, { error: '公車資料暫時無法取得，請稍後再試。' }, 502, request.headers['accept-encoding']);
  }
});

server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`無法啟動：連接埠 ${PORT} 已被其他程式使用。可先關閉舊伺服器，或使用 PORT=5181 npm start。`);
  } else {
    console.error('伺服器啟動失敗：', error.message);
  }
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  console.log(`Taipei Bus Live: http://${HOST}:${PORT}`);
});
