import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { advanceDisplayedCoordinate, followCoordinate, predictBusCoordinate, stabilizeRouteTarget } from '../public/bus-motion.mjs';
import { describeBusMotion, formatRelativeAge } from '../public/presentation.mjs';
import { describeArrival } from '../public/arrival.mjs';

const APP_URL = new URL('../public/app.js', import.meta.url);
const flush = () => new Promise(resolve => setImmediate(resolve));

function response(body) {
  return Promise.resolve({ ok: true, json: async () => body });
}

function snapshot(snapshotAt, updatedAt = snapshotAt) {
  return {
    schemaVersion: 1,
    snapshotAt,
    checkedAt: updatedAt,
    buses: [{
      id: 'BUS-1', plate: 'BUS-1', route: '307', routeId: '307', operator: '測試客運',
      shapeRouteId: '307',
      direction: 0, destination: '台北車站', lat: 25.04, lon: 121.54,
      speed: 12, bearing: 90, updatedAt, ageSec: 0,
    }],
  };
}

async function harness(fetches, { zoom = 14, reducedMotion = true, initialUrl = 'https://example.test/' } = {}) {
  const requests = [];
  const elements = new Map();
  const storage = new Map();
  const windowListeners = new Map();
  let currentUrl = new URL(initialUrl);
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      id, dataset: {}, disabled: false, hidden: id === 'busSheet' || id === 'filterStatus',
      style: {}, textContent: '', value: '', listeners: new Map(), children: [], attributes: {},
      addEventListener(name, listener) { this.listeners.set(name, listener); },
      setAttribute(name, value) { this.attributes[name] = value; },
      appendChild(child) { this.children.push(child); },
      replaceChildren(...children) { this.children = children; },
      focus() {},
    });
    return elements.get(id);
  };

  class FakeMap {
    constructor() { this.handlers = new Map(); this.sources = new Map(); this.layers = new Map(); }
    addControl() {}
    on(name, layer, listener) {
      if (typeof layer === 'function') this.handlers.set(name, layer);
      else this.handlers.set(`${name}:${layer}`, listener);
    }
    addSource(id, config) {
      this.sources.set(id, {
        data: config?.data || null,
        setDataCalls: 0,
        updateDataCalls: [],
        setData(data) { this.data = data; this.setDataCalls += 1; },
        updateData(diff) { this.updateDataCalls.push(diff); return Promise.resolve(); },
        getClusterExpansionZoom: async () => 12,
      });
    }
    getSource(id) { return this.sources.get(id); }
    addLayer(layer) { this.layers.set(layer.id, layer); }
    getLayer(id) { return this.layers.get(id); }
    setFilter(id, filter) { if (this.layers.has(id)) this.layers.get(id).filter = filter; }
    getCanvas() { return { style: {} }; }
    getZoom() { return zoom; }
    fitBounds() {}
    easeTo() {}
  }

  const intervals = new Map();
  const fakeMap = new FakeMap();
  const context = vm.createContext({
    console,
    document: {
      hidden: false,
      getElementById: element,
      createElement: () => element(Symbol()),
      addEventListener() {},
    },
    fetch: url => {
      requests.push(String(url));
      if (String(url).endsWith('/eta')) return response({
        schemaVersion: 1, routeId: '307', snapshotAt: '2026-09-28T14:00:00.000Z',
        checkedAt: '2026-09-28T14:00:00.000Z', estimates: [{ stopId: 'S1', seconds: 180 }],
      });
      if (String(url).startsWith('/api/routes/')) return response({
        schemaVersion: 1, routeId: '307',
        direction: Number(new URL(String(url), 'http://localhost').searchParams.get('direction')),
        shape: [[121.53, 25.03], [121.54, 25.04], [121.55, 25.05]],
        stops: [
          { id: 'S1', name: '第一站', sequence: 1, lon: 121.53, lat: 25.03, address: '', bearing: 'E' },
          { id: 'S2', name: '第二站', sequence: 2, lon: 121.55, lat: 25.05, address: '', bearing: 'E' },
        ],
      });
      const next = fetches.shift();
      if (!next) throw new Error('Unexpected fetch');
      return next;
    },
    maplibregl: {
      Map: class { constructor() { return fakeMap; } },
      NavigationControl: class {},
      LngLatBounds: class { extend() { return this; } },
      Popup: class { setLngLat() { return this; } setText() { return this; } addTo() { return this; } },
    },
    window: {
      get location() { return currentUrl; },
      history: { replaceState(_state, _title, url) { currentUrl = new URL(url); } },
      addEventListener(name, listener) { windowListeners.set(name, listener); },
    },
    localStorage: { getItem(key) { return storage.get(key) || null; }, setItem(key, value) { storage.set(key, value); } },
    navigator: { clipboard: { async writeText(value) { storage.set('clipboard', value); } } },
    URL, URLSearchParams,
    matchMedia: () => ({ matches: reducedMotion }),
    predictBusCoordinate,
    advanceDisplayedCoordinate,
    followCoordinate,
    stabilizeRouteTarget,
    describeBusMotion,
    formatRelativeAge,
    describeArrival,
    setInterval(callback, milliseconds) { intervals.set(milliseconds, callback); return intervals.size; },
    clearTimeout() {},
    setTimeout(callback) { callback(); return 1; },
  });

  const source = (await readFile(APP_URL, 'utf8')).replace(/^import .*?;\s*$/gm, '');
  vm.runInContext(source, context, { filename: 'public/app.js' });
  fakeMap.handlers.get('load')();
  await flush(); await flush();
  return {
    element, map: fakeMap, requests, storage,
    get url() { return currentUrl; },
    tick: () => intervals.get(1_000)(),
    animateTick: () => intervals.get(250)(),
  };
}

test('背景的一秒輪詢不顯示手動更新旋轉狀態', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const app = await harness([response(snapshot('2026-09-28T14:00:00.000Z')), pending]);
  app.tick();
  assert.equal(app.element('refreshButton').dataset.loading, 'false');
  release({ ok: true, json: async () => snapshot('2026-09-28T14:00:00.000Z', '2026-09-28T14:00:01.000Z') });
  await flush();
});

test('相同官方快照只更新精確檢查資訊，不假裝有新資料', async () => {
  const app = await harness([
    response(snapshot('2026-09-28T14:00:00.000Z')),
    response(snapshot('2026-09-28T14:00:00.000Z', '2026-09-28T14:00:01.000Z')),
  ]);
  const beforeTitle = app.element('updatedTime').title;
  app.tick();
  await flush(); await flush();
  assert.equal(app.element('updatedTime').textContent, '剛剛');
  assert.notEqual(app.element('updatedTime').title, beforeTitle);
});

test('摘要顯示官方資料年齡，不把每秒檢查誤認成新 GPS', async () => {
  const app = await harness([
    response(snapshot('2026-09-28T14:00:00.000Z')),
    response(snapshot('2026-09-28T14:00:00.000Z', '2026-09-28T14:00:20.000Z')),
  ]);
  app.tick();
  await flush(); await flush();
  assert.equal(app.element('updatedTime').textContent, '20 秒前');
});

test('官方快照超過三十秒時清楚標示資料延遲', async () => {
  const app = await harness([response(snapshot(
    '2026-09-28T14:00:00.000Z',
    '2026-09-28T14:00:31.000Z',
  ))]);
  assert.equal(app.element('liveStatus').dataset.state, 'stale');
  assert.match(app.element('statusText').textContent, /資料延遲/);
});

test('已開啟的車輛資訊會跟著新快照更新', async () => {
  const app = await harness([
    response(snapshot('2026-09-28T14:00:00.000Z')),
    response(snapshot('2026-09-28T14:00:01.000Z')),
  ]);
  app.map.handlers.get('click:bus-points')({ features: [{ properties: { id: 'BUS-1' } }] });
  const before = app.element('busUpdated').textContent;
  app.tick();
  await flush(); await flush();
  assert.notEqual(app.element('busUpdated').textContent, before);
});

test('已開啟的車輛資訊卡每秒更新檢查時間', async () => {
  const app = await harness([
    response(snapshot('2026-09-28T14:00:00.000Z')),
    response(snapshot('2026-09-28T14:00:00.000Z', '2026-09-28T14:00:01.000Z')),
  ]);
  app.map.handlers.get('click:bus-points')({ features: [{ properties: { id: 'BUS-1' } }] });
  const before = app.element('busChecked').textContent;
  app.tick();
  await flush(); await flush();
  assert.notEqual(app.element('busChecked').textContent, before);
});

test('車輛資訊卡清楚標示位置推估方式', async () => {
  const app = await harness([response(snapshot('2026-09-28T14:00:00.000Z'))]);
  app.map.handlers.get('click:bus-points')({ features: [{ properties: { id: 'BUS-1' } }] });
  assert.equal(app.element('busMotionStatus').textContent, '方位推估');
  assert.match(app.element('busMotionDetail').textContent, /速度與方位/);
});

test('地圖來源只保留繪圖必要欄位，避免動畫重複序列化完整車況', async () => {
  const app = await harness([response(snapshot('2026-09-28T14:00:00.000Z'))]);
  const [feature] = app.map.getSource('buses').data.features;
  assert.deepEqual(Object.keys(feature.properties).sort(), ['id', 'route']);
});

test('選取車輛會同步高亮標記與開啟資訊卡狀態', async () => {
  const app = await harness([response(snapshot('2026-09-28T14:00:00.000Z'))]);
  app.map.handlers.get('click:bus-points')({ features: [{ properties: { id: 'BUS-1' } }] });
  assert.equal(app.element('appShell').dataset.sheetOpen, 'true');
  assert.equal(app.map.getLayer('bus-selected').filter.at(-1), 'BUS-1');
});

test('選取車輛才按方向載入路線站牌與官方線形', async () => {
  const app = await harness([response(snapshot('2026-09-28T14:00:00.000Z'))]);
  assert.equal(app.requests.some(url => url.startsWith('/api/routes/')), false);
  app.map.handlers.get('click:bus-points')({ features: [{ properties: { id: 'BUS-1' } }] });
  await flush(); await flush();
  assert.ok(app.requests.includes('/api/routes/307/stops?direction=0'));
  assert.equal(app.element('routeStopsStatus').textContent, '已顯示 2 站 · 去程');
  const features = app.map.getSource('selected-route').data.features;
  assert.equal(features.filter(feature => feature.geometry.type === 'LineString').length, 1);
  assert.equal(features.filter(feature => feature.geometry.type === 'Point').length, 2);
});

test('站牌選擇可顯示官方 ETA，並標示官方資料時間', async () => {
  const app = await harness([response(snapshot('2026-09-28T14:00:00.000Z'))]);
  app.map.handlers.get('click:bus-points')({ features: [{ properties: { id: 'BUS-1' } }] });
  await flush(); await flush();
  assert.ok(app.requests.includes('/api/routes/307/eta'));
  app.element('stopSelect').value = 'S1';
  app.element('stopSelect').listeners.get('change')();
  assert.equal(app.element('stopEta').textContent, '約 3 分鐘');
  assert.match(app.element('etaUpdated').textContent, /官方預估更新/);
});

test('可收藏路線並用常用路線按鈕搜尋', async () => {
  const app = await harness([response(snapshot('2026-09-28T14:00:00.000Z'))]);
  app.map.handlers.get('click:bus-points')({ features: [{ properties: { id: 'BUS-1' } }] });
  app.element('favoriteButton').listeners.get('click')();
  assert.equal(app.element('favoriteButton').attributes['aria-pressed'], 'true');
  assert.equal(app.element('favorites').hidden, false);
  assert.deepEqual(JSON.parse(app.storage.get('taipei-bus-live:favorites:v1')), ['307']);
  app.element('favoriteRoutes').children[0].listeners.get('click')();
  assert.equal(app.element('searchInput').value, '307');
  assert.equal(app.url.searchParams.get('q'), '307');
});

test('分享路線複製可重新開啟的路線搜尋連結', async () => {
  const app = await harness([response(snapshot('2026-09-28T14:00:00.000Z'))]);
  app.map.handlers.get('click:bus-points')({ features: [{ properties: { id: 'BUS-1' } }] });
  await app.element('shareButton').listeners.get('click')();
  assert.equal(new URL(app.storage.get('clipboard')).searchParams.get('q'), '307');
  assert.match(app.element('shareStatus').textContent, /已複製/);
});

test('分享連結重新開啟時還原路線搜尋', async () => {
  const app = await harness([response(snapshot('2026-09-28T14:00:00.000Z'))], {
    initialUrl: 'https://example.test/?q=307',
  });
  assert.equal(app.element('searchInput').value, '307');
  assert.match(app.element('filterText').textContent, /307/);
  assert.equal(app.map.getSource('buses').data.features.length, 1);
});

test('官方方向碼校正後，站牌與藍線使用實際匹配方向', async () => {
  const body = snapshot('2026-09-28T14:00:00.000Z');
  body.buses[0].motionDirection = 1;
  const app = await harness([response(body)]);
  app.map.handlers.get('click:bus-points')({ features: [{ properties: { id: 'BUS-1' } }] });
  await flush(); await flush();
  assert.ok(app.requests.includes('/api/routes/307/stops?direction=1'));
  assert.equal(app.element('routeStopsStatus').textContent, '已顯示 2 站 · 回程');
});

test('已選車輛方向改變時，站牌與藍線改載新方向', async () => {
  const first = snapshot('2026-09-28T14:00:00.000Z');
  const second = snapshot('2026-09-28T14:00:05.000Z');
  second.buses[0].direction = 1;
  const app = await harness([response(first), response(second)]);
  app.map.handlers.get('click:bus-points')({ features: [{ properties: { id: 'BUS-1' } }] });
  await flush(); await flush();
  app.tick();
  await flush(); await flush();
  assert.ok(app.requests.includes('/api/routes/307/stops?direction=1'));
  assert.equal(app.element('routeStopsStatus').textContent, '已顯示 2 站 · 回程');
});

test('上游故障而保留舊車況時，介面不能顯示已連線', async () => {
  const body = snapshot('2026-09-28T14:00:00.000Z', '2026-09-28T14:00:01.000Z');
  body.upstreamStale = true;
  const app = await harness([response(body)]);
  assert.equal(app.element('liveStatus').dataset.state, 'stale');
  assert.match(app.element('statusText').textContent, /資料延遲|暫時無法更新/);
});

test('總覽縮放停止動畫時，新快照仍更新既有車輛座標', async () => {
  const first = snapshot('2026-09-28T14:00:00.000Z');
  const second = snapshot('2026-09-28T14:00:05.000Z');
  second.buses[0].lon = 121.55;
  const app = await harness([response(first), response(second)], { zoom: 11.1, reducedMotion: false });
  app.tick();
  await flush(); await flush();
  assert.equal(app.map.getSource('buses').data.features[0].geometry.coordinates[0], 121.55);
});

test('支線車輛載入站牌時要求與定位相同的支線線形', async () => {
  const body = snapshot('2026-09-28T14:00:00.000Z');
  body.buses[0].routeId = '30701';
  body.buses[0].routeKey = 'sub:30701:0';
  const app = await harness([response(body)]);
  app.map.handlers.get('click:bus-points')({ features: [{ properties: { id: 'BUS-1' } }] });
  await flush(); await flush();
  assert.ok(app.requests.includes('/api/routes/307/stops?direction=0&subRouteId=30701'));
});

test('動畫只更新移動的車點，不重送整份 GeoJSON', async () => {
  const body = snapshot('2026-09-28T14:00:00.000Z');
  body.buses[0].motionMode = 'route';
  body.buses[0].estimatedAt = '2026-09-28T14:00:00.000Z';
  body.buses[0].motionPathUntil = '2026-09-28T14:00:02.000Z';
  body.buses[0].motionPath = [[121.54, 25.04], [121.541, 25.04]];
  const app = await harness([response(body)], { zoom: 14, reducedMotion: false });
  const source = app.map.getSource('buses');
  const before = source.setDataCalls;
  app.animateTick();
  assert.equal(source.setDataCalls, before);
  assert.equal(source.updateDataCalls.length, 1);
  assert.equal(source.updateDataCalls[0].update[0].id, 'BUS-1');
});
