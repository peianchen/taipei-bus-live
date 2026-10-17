import { gzipSync } from 'node:zlib';

export function prepareJson(body) {
  const plain = Buffer.from(JSON.stringify(body));
  return {
    plain,
    gzip: plain.length >= 1_024 ? gzipSync(plain, { level: 1 }) : null,
  };
}

export function selectJsonPayload(prepared, acceptEncoding = '') {
  const useGzip = prepared.gzip && /(?:^|,)\s*gzip(?:\s*;|\s*,|$)/i.test(acceptEncoding);
  return { buffer: useGzip ? prepared.gzip : prepared.plain, compressed: Boolean(useGzip) };
}
