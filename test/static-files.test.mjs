import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveStaticFile } from '../src/static-files.mjs';

const root = path.dirname(fileURLToPath(new URL('../server.mjs', import.meta.url)));

test('靜態資源可載入首頁與明確列出的地圖套件', () => {
  assert.equal(resolveStaticFile(root, '/'), path.join(root, 'public/index.html'));
  assert.equal(resolveStaticFile(root, '/app.js'), path.join(root, 'public/app.js'));
  assert.equal(resolveStaticFile(root, '/vendor/maplibre-gl.mjs'),
    path.join(root, 'node_modules/maplibre-gl/dist/maplibre-gl.mjs'));
});

test('編碼斜線解碼後不得越過 public 讀取伺服器或 Git 檔案', () => {
  for (const requestPath of ['/%2e%2e%2fserver.mjs', '/%2e%2e%2f.git%2fconfig']) {
    const pathname = decodeURIComponent(new URL(requestPath, 'http://localhost').pathname);
    assert.equal(resolveStaticFile(root, pathname), null, requestPath);
  }
});
