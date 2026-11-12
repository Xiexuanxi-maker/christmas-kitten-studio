import { describe, expect, it, vi } from 'vitest';
import { inspectCloudflare } from '../scripts/inspect-cloudflare.mjs';

const account = 'a'.repeat(32);
const token = 'sensitive-test-token';
const options = { account, token, owner: 'Xiexuanxi-maker' };
const response = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});
const missing = () => response({ success: false, errors: [{ code: 10007 }] }, 404);

describe('Cloudflare account subdomain preparation', () => {
  it('reuses an existing subdomain without modifying the account', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ success: true, result: { subdomain: 'existing-studio' } }));
    await expect(inspectCloudflare({ ...options, fetcher })).resolves.toEqual({
      workers_subdomain: 'existing-studio', app_hostname: 'christmas-kitten-studio.existing-studio.workers.dev',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1].method).toBeUndefined();
  });
  it.each([
    [404, { success: false, errors: [{ code: 10000 }] }],
    [404, { success: false, errors: [{ code: 10007 }, { code: 10000 }] }],
    [403, { success: false, errors: [{ code: 10007 }] }],
    [404, { success: true, errors: [{ code: 10007 }] }],
    [200, { success: true, result: { subdomain: '../invalid' } }],
  ])('does not create after ambiguous or unauthorized lookup HTTP %s', async (status, body) => {
    const fetcher = vi.fn().mockResolvedValue(response(body, status));
    const result = await inspectCloudflare({ ...options, fetcher });
    expect(result.workers_subdomain).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('creates exactly once after the specific missing-account-subdomain response', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(missing())
      .mockResolvedValueOnce(response({ success: true, result: { subdomain: 'xiexuanxi-maker' } }));
    const result = await inspectCloudflare({ ...options, fetcher });
    expect(result.app_hostname).toBe('christmas-kitten-studio.xiexuanxi-maker.workers.dev');
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [url, init] = fetcher.mock.calls[1];
    expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/subdomain`);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ subdomain: 'xiexuanxi-maker' });
    expect(init.headers.Authorization).toBe(`Bearer ${token}`);
    expect(init.redirect).toBe('error');
    expect(JSON.stringify(result)).not.toContain(token);
  });
  it('does not retry a rejected creation or expose upstream messages and credentials', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(missing()).mockResolvedValueOnce(response({
      success: false, errors: [{ code: 10031, message: `private ${token}` }],
    }, 409));
    const result = await inspectCloudflare({ ...options, fetcher });
    expect(result.workers_subdomain).toBeNull();
    expect(result.message).toContain('HTTP 409; codes 10031');
    expect(result.registration_failed).toBe(true);
    expect(JSON.stringify(result)).not.toContain(token);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('verifies a successful creation whose response omits the registered domain', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(missing())
      .mockResolvedValueOnce(response({ success: true, result: {} }))
      .mockResolvedValueOnce(response({ success: true, result: { subdomain: 'provider-confirmed' } }));
    const result = await inspectCloudflare({ ...options, fetcher });
    expect(result.app_hostname).toBe('christmas-kitten-studio.provider-confirmed.workers.dev');
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[2][1].method).toBeUndefined();
  });
  it('never invents a hostname when creation cannot be confirmed', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(missing())
      .mockResolvedValueOnce(response({ success: true, result: {} }))
      .mockResolvedValueOnce(response({ success: false, errors: [{ code: 10007 }] }, 404));
    const result = await inspectCloudflare({ ...options, fetcher });
    expect(result.app_hostname).toBeNull();
    expect(result.registration_failed).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('sanitizes network failures during creation without retrying', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(missing())
      .mockRejectedValueOnce(new Error(`request failed: ${token}`));
    const result = await inspectCloudflare({ ...options, fetcher });
    expect(result.workers_subdomain).toBeNull();
    expect(JSON.stringify(result)).not.toContain(token);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('validates account credentials before making any request', async () => {
    const fetcher = vi.fn();
    await expect(inspectCloudflare({ ...options, account: 'invalid', fetcher })).rejects.toThrow('ACCOUNT_ID is missing or invalid');
    await expect(inspectCloudflare({ ...options, token: 'bad\nheader', fetcher })).rejects.toThrow('API_TOKEN is missing or invalid');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
