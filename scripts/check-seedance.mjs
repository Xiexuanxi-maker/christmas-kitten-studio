import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TASK_LIST_URL = 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks?page_size=1&page_num=1';
const OVERDUE_CODES = new Set(['AccountOverdueError', 'OperationDenied.ServiceOverdue']);
const NETWORK_CODES = new Map([
  ...['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL'].map(code => [code, 'NETWORK_DNS']),
  ...['CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_TLS_CERT_ALTNAME_INVALID', 'ERR_SSL_WRONG_VERSION_NUMBER', 'ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION'].map(code => [code, 'NETWORK_TLS']),
  ...['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].map(code => [code, 'NETWORK_TIMEOUT']),
  ...['ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'EHOSTUNREACH', 'EPIPE', 'UND_ERR_SOCKET'].map(code => [code, 'NETWORK_CONNECTION']),
]);

function networkReason(error) {
  const queue = [error];
  // Node fetch wraps system errors in cause; connection attempts can also use AggregateError.
  for (let index = 0; index < queue.length && index < 12; index += 1) {
    const item = queue[index];
    if (!item || typeof item !== 'object') continue;
    if (item.name === 'TimeoutError' || item.name === 'AbortError') return 'NETWORK_TIMEOUT';
    const known = NETWORK_CODES.get(item.code);
    if (known) return known;
    if (item.cause) queue.push(item.cause);
    if (Array.isArray(item.errors)) queue.push(...item.errors.slice(0, 8));
  }
  return 'NETWORK_OTHER';
}

/** Read-only authentication check. A successful query does not verify model activation or funds. */
export async function probeSeedanceKey({ apiKey, fetcher = globalThis.fetch } = {}) {
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!key) return { code: 'ARK_PROBE_FAILED', reason: 'MISSING_KEY' };
  // Trim clipboard whitespace first; reject internal control characters, spaces and Unicode labels.
  if (!/^[\x21-\x7E]+$/.test(key)) return { code: 'ARK_PROBE_FAILED', reason: 'INVALID_HEADER' };
  if (typeof fetcher !== 'function') return { code: 'ARK_PROBE_FAILED', reason: 'INVALID_RESPONSE' };
  let httpStatus;
  try {
    const response = await fetcher(TASK_LIST_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(25_000),
    });
    if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
      return { code: 'ARK_PROBE_FAILED', reason: 'INVALID_RESPONSE' };
    }
    httpStatus = response.status;
    // Never log the response: even a read-only list can contain private task and download URLs.
    let data;
    try { data = await response.json(); } catch { data = null; }
    if (httpStatus === 200) {
      return Array.isArray(data?.items)
        ? { code: 'ARK_AUTH_OK', httpStatus }
        : { code: 'ARK_PROBE_FAILED', httpStatus, reason: 'INVALID_RESPONSE' };
    }
    if ((httpStatus === 402 || httpStatus === 403) && OVERDUE_CODES.has(data?.error?.code)) {
      return { code: 'ARK_ACCOUNT_OVERDUE', httpStatus };
    }
    if (httpStatus === 401) return { code: 'ARK_AUTH_FAILED', httpStatus };
    if (httpStatus === 403) return { code: 'ARK_PERMISSION_DENIED', httpStatus };
    return { code: 'ARK_PROBE_FAILED', httpStatus };
  } catch (error) {
    // Network exceptions can include request headers. Expose only a whitelisted reason.
    return { code: 'ARK_PROBE_FAILED', ...(httpStatus ? { httpStatus } : {}), reason: networkReason(error) };
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const result = await probeSeedanceKey({ apiKey: process.env.ARK_API_KEY });
  process.stdout.write(`${result.code}${result.httpStatus ? ` HTTP_${result.httpStatus}` : ''}${result.reason ? ` ${result.reason}` : ''}\n`);
  process.exitCode = result.code === 'ARK_AUTH_OK' ? 0 : 1;
}
