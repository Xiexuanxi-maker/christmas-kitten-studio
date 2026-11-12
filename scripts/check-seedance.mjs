import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TASK_LIST_URL = 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks?page_size=1&page_num=1';
const OVERDUE_CODES = new Set(['AccountOverdueError', 'OperationDenied.ServiceOverdue']);

/** Read-only authentication check. A successful query does not verify model activation or funds. */
export async function probeSeedanceKey({ apiKey, fetcher = globalThis.fetch } = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim() || /[\r\n]/.test(apiKey) || typeof fetcher !== 'function') {
    return { code: 'ARK_PROBE_FAILED' };
  }
  let httpStatus;
  try {
    const response = await fetcher(TASK_LIST_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey.trim()}`, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(25_000),
    });
    if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
      return { code: 'ARK_PROBE_FAILED' };
    }
    httpStatus = response.status;
    // Never log the response: even a read-only list can contain private task and download URLs.
    let data;
    try { data = await response.json(); } catch { data = null; }
    if (httpStatus === 200) {
      return { code: Array.isArray(data?.items) ? 'ARK_AUTH_OK' : 'ARK_PROBE_FAILED', httpStatus };
    }
    if ((httpStatus === 402 || httpStatus === 403) && OVERDUE_CODES.has(data?.error?.code)) {
      return { code: 'ARK_ACCOUNT_OVERDUE', httpStatus };
    }
    if (httpStatus === 401) return { code: 'ARK_AUTH_FAILED', httpStatus };
    if (httpStatus === 403) return { code: 'ARK_PERMISSION_DENIED', httpStatus };
    return { code: 'ARK_PROBE_FAILED', httpStatus };
  } catch {
    // Network exceptions can include request headers. Return only fixed diagnostic codes.
    return { code: 'ARK_PROBE_FAILED', ...(httpStatus ? { httpStatus } : {}) };
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const result = await probeSeedanceKey({ apiKey: process.env.ARK_API_KEY });
  process.stdout.write(`${result.code}${result.httpStatus ? ` HTTP_${result.httpStatus}` : ''}\n`);
  process.exitCode = result.code === 'ARK_AUTH_OK' ? 0 : 1;
}
