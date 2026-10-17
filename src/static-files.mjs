import path from 'node:path';

const VENDOR_FILES = new Map([
  ['/vendor/maplibre-gl.mjs', 'node_modules/maplibre-gl/dist/maplibre-gl.mjs'],
  ['/vendor/maplibre-gl-shared.mjs', 'node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs'],
  ['/vendor/maplibre-gl-worker.mjs', 'node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs'],
  ['/vendor/maplibre-gl.css', 'node_modules/maplibre-gl/dist/maplibre-gl.css'],
]);

export function resolveStaticFile(root, pathname) {
  const vendor = VENDOR_FILES.get(pathname);
  if (vendor) return path.resolve(root, vendor);
  if (!pathname.startsWith('/') || pathname.includes('\0')) return null;
  const publicRoot = path.resolve(root, 'public');
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const target = path.resolve(publicRoot, relative);
  return target.startsWith(publicRoot + path.sep) ? target : null;
}

export function isVendorFile(pathname) {
  return VENDOR_FILES.has(pathname);
}
