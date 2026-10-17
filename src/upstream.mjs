const UPSTREAM_TIMEOUT_MS = 10_000;

export function fetchUpstream(url, { timeoutMs = UPSTREAM_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  return fetchImpl(url, {
    cache: 'no-store',
    headers: { accept: 'application/gzip, application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
}
