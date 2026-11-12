import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { probeSeedanceKey } from '../scripts/check-seedance.mjs';

const apiKey = 'private-example-key-never-print';
const privateUrl = 'https://private.example/signed-video?secret=never-print';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
afterEach(() => vi.restoreAllMocks());

describe('read-only Seedance credential probe', () => {
  it('uses only the pinned official GET endpoint, no model filter and no billable request', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ items: [{ id: 'private-task', content: { video_url: privateUrl } }], total: 1 }));
    await expect(probeSeedanceKey({ apiKey: ` ${apiKey} `, fetcher })).resolves.toEqual({ code: 'ARK_AUTH_OK', httpStatus: 200 });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks?page_size=1&page_num=1');
    expect(url).not.toContain('filter.model');
    expect(options.method).toBe('GET');
    expect(options.body).toBeUndefined();
    expect(options.headers.Authorization).toBe(`Bearer ${apiKey}`);
    expect(options.redirect).toBe('error');
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('accepts an empty task list without claiming model generation readiness', async () => {
    const result = await probeSeedanceKey({ apiKey, fetcher: async () => json({ items: [], total: 0 }) });
    expect(result).toEqual({ code: 'ARK_AUTH_OK', httpStatus: 200 });
    expect(Object.keys(result)).toEqual(['code', 'httpStatus']);
  });

  it.each([
    [401, { error: { code: 'AuthenticationError', message: apiKey } }, 'ARK_AUTH_FAILED'],
    [403, { error: { code: 'AccessDenied', message: privateUrl } }, 'ARK_PERMISSION_DENIED'],
    [403, { error: { code: 'AccountOverdueError' } }, 'ARK_ACCOUNT_OVERDUE'],
    [403, { error: { code: 'OperationDenied.ServiceOverdue' } }, 'ARK_ACCOUNT_OVERDUE'],
    [403, { error: { code: 'OperationDenied.ServiceNotOpen' } }, 'ARK_PERMISSION_DENIED'],
    [404, { error: { code: 'ModelNotOpen' } }, 'ARK_PROBE_FAILED'],
    [429, { error: { code: 'APIAccountRpmRateLimitExceeded' } }, 'ARK_PROBE_FAILED'],
    [500, { error: { message: `${apiKey} ${privateUrl}` } }, 'ARK_PROBE_FAILED'],
  ])('maps HTTP %s to the fixed diagnostic %s without exposing upstream data', async (status, body, code) => {
    const result = await probeSeedanceKey({ apiKey, fetcher: async () => json(body, status) });
    expect(result).toEqual({ code, httpStatus: status });
    expect(JSON.stringify(result)).not.toContain(apiKey);
    expect(JSON.stringify(result)).not.toContain(privateUrl);
  });

  it.each([{}, { items: null }, { items: {} }, { error: { message: apiKey } }, null])('rejects successful HTTP responses without an items array', async (body) => {
    await expect(probeSeedanceKey({ apiKey, fetcher: async () => json(body) })).resolves.toEqual({ code: 'ARK_PROBE_FAILED', httpStatus: 200 });
  });

  it('handles malformed JSON without printing response text', async () => {
    const log = vi.spyOn(console, 'log');
    const error = vi.spyOn(console, 'error');
    const result = await probeSeedanceKey({ apiKey, fetcher: async () => new Response(`<html>${apiKey} ${privateUrl}</html>`) });
    expect(result).toEqual({ code: 'ARK_PROBE_FAILED', httpStatus: 200 });
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it.each([undefined, '', '   ', `${apiKey}\r\nInjected: true`])('rejects unusable credentials before making a request', async (value) => {
    const fetcher = vi.fn();
    await expect(probeSeedanceKey({ apiKey: value, fetcher })).resolves.toEqual({ code: 'ARK_PROBE_FAILED' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not expose request details from network or timeout errors', async () => {
    const result = await probeSeedanceKey({ apiKey, fetcher: async () => { throw new Error(`Authorization: Bearer ${apiKey} ${privateUrl}`); } });
    expect(result).toEqual({ code: 'ARK_PROBE_FAILED' });
  });

  it('CLI emits only a fixed code and fails when its environment secret is missing', () => {
    const result = spawnSync(process.execPath, ['scripts/check-seedance.mjs'], { cwd: process.cwd(), env: { ...process.env, ARK_API_KEY: '' }, encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('ARK_PROBE_FAILED\n');
    expect(result.stderr).toBe('');
  });
});
