import { afterEach, describe, expect, it, vi } from 'vitest';
const identity = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock('jose', () => ({ jwtVerify: identity.verify, createRemoteJWKSet: vi.fn(() => 'keys') }));
import app, { type Env } from '../worker/index';
import { initialShots } from '../src/storyboard';

const assetFetch = vi.fn(() => new Response('<html>studio</html>', { headers: { 'Content-Type': 'text/html' } }));
const env = {
  ADMIN_EMAIL: 'xiexuanxi@outlook.fr',
  ASSETS: { fetch: assetFetch },
} as unknown as Env;
afterEach(() => { vi.unstubAllGlobals(); assetFetch.mockClear(); identity.verify.mockReset(); });

describe('API authorization and browser request boundary', () => {
  it('reports connection state without exposing secrets when Access is not configured', async () => {
    const response = await app.request('https://studio.example/api/session', {}, { ...env, ARK_API_KEY: 'private-ark-key', DB: {} as D1Database, MEDIA: {} as R2Bucket });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authenticated: false, email: null, role: null,
      configured: { access: false, seedance: true, ai: false, database: true, storage: true },
      loginUrl: 'https://studio.example/cdn-cgi/access/login',
    });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it.each(['/api/project', '/api/generations', '/api/assets'])('denies protected endpoint %s without Access configuration', async (path) => {
    const response = await app.request(`https://studio.example${path}`, {}, env);
    expect(response.status).toBe(401);
    expect((await response.json() as { error: string }).error).toContain('Cloudflare Access');
    expect(assetFetch).not.toHaveBeenCalled();
  });

  it('does not trust a spoofed administrator email header', async () => {
    const response = await app.request('https://studio.example/api/project', {
      headers: { 'Cf-Access-Authenticated-User-Email': env.ADMIN_EMAIL, 'X-User-Email': env.ADMIN_EMAIL },
    }, { ...env, ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', ACCESS_AUDIENCE: 'audience' });
    expect(response.status).toBe(401);
    expect(assetFetch).not.toHaveBeenCalled();
  });

  it.each([
    { Origin: 'https://malicious.example' },
    { 'Sec-Fetch-Site': 'cross-site' },
  ] as Record<string,string>[])('rejects cross-site mutations before authentication or billable work', async (headers) => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const response = await app.request('https://studio.example/api/generations', {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}',
    }, env);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Cross-origin requests are not allowed.' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('retains the authenticated boundary for same-origin mutations', async () => {
    const response = await app.request('https://studio.example/api/generations', {
      method: 'POST', headers: { Origin: 'https://studio.example', 'Content-Type': 'application/json' }, body: '{}',
    }, env);
    expect(response.status).toBe(401);
  });

  it('does not fall through to the SPA for missing API endpoints or the API root', async () => {
    for (const path of ['/api', '/api/', '/api/missing']) {
      const response = await app.request(`https://studio.example${path}`, {}, env);
      expect([401, 404]).toContain(response.status);
      expect(response.headers.get('Content-Type')).toContain('application/json');
    }
    expect(assetFetch).not.toHaveBeenCalled();
  });

  it('returns JSON 404 for unknown API routes after successful authentication', async () => {
    identity.verify.mockResolvedValue({ payload: { email: env.ADMIN_EMAIL } });
    for (const path of ['/api', '/api/', '/api/missing']) {
      const response = await app.request(`https://studio.example${path}`, {
        headers: { 'Cf-Access-Jwt-Assertion': 'signed' },
      }, { ...env, ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', ACCESS_AUDIENCE: 'app-audience' });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'Endpoint not found.' });
    }
    expect(assetFetch).not.toHaveBeenCalled();
  });

  it('serves the public readiness endpoint without authentication', async () => {
    const response = await app.request('https://studio.example/api/health', {}, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, service: 'purrfect-studio' });
  });

  it('still routes non-API documents to the application assets binding', async () => {
    const response = await app.request('https://studio.example/storyboard', {}, env);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('studio');
    expect(assetFetch).toHaveBeenCalledOnce();
  });
});


describe('Seedance generation carries the approved sound direction', () => {
  it.each([undefined, 'Quiet acrylic clicks and soft Christmas bells.'])('includes sound direction with optional user override %s', async (audio) => {
    identity.verify.mockResolvedValue({ payload: { email: env.ADMIN_EMAIL } });
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'cgt-audio-test' }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    const run = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
    const bind = vi.fn().mockReturnValue({ run });
    const prepare = vi.fn().mockReturnValue({ bind });
    const response = await app.request('https://studio.example/api/generations', {
      method: 'POST', headers: { Origin: 'https://studio.example', 'Content-Type': 'application/json', 'Cf-Access-Jwt-Assertion': 'signed' },
      body: JSON.stringify({ shotId: initialShots[0].id, prompt: initialShots[0].prompt, duration: 3, ratio: '9:16', ...(audio ? { audio } : {}) }),
    }, { ...env, ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', ACCESS_AUDIENCE: 'app-audience', ARK_API_KEY: 'private-key', MEDIA: {} as R2Bucket, DB: { prepare } as unknown as D1Database });
    expect(response.status).toBe(201);
    const upstream = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(upstream.content[0].text).toContain(initialShots[0].prompt);
    expect(upstream.content[0].text).toContain(`Audio direction: ${audio ?? initialShots[0].audio}`);
    expect(upstream.content[0].text).toContain('No spoken dialogue.');
    expect(upstream.content[0].text).toContain('subtitles will be added in editing');
    expect(upstream.generate_audio).toBe(true);
    expect(upstream.duration).toBe(4);
  });
});
