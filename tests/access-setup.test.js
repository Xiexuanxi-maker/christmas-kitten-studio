import { describe, expect, it, vi } from 'vitest';
import { setupAccess } from '../scripts/setup-access.mjs';

const account = 'a'.repeat(32);
const token = 'private-cf-test-token';
const hostname = 'christmas-kitten-studio.xiexuanxi-maker.workers.dev';
const ownerEmail = 'xiexuanxi@outlook.fr';
const otpId = '11111111-1111-4111-8111-111111111111';
const appId = '22222222-2222-4222-8222-222222222222';
const aud = 'b'.repeat(64);
const ownerPolicy = () => ({ id: '33333333-3333-4333-8333-333333333333', name: 'Kitten Studio administrator', decision: 'allow', precedence: 1, include: [{ email: { email: ownerEmail } }], exclude: [], require: [] });
const ownApp = () => ({ id: appId, name: 'Christmas Kitten Studio', type: 'self_hosted', domain: hostname, destinations: [{ type: 'public', uri: hostname }], allowed_idps: [otpId], auto_redirect_to_identity: true, http_only_cookie_attribute: true, session_duration: '24h', aud });
const json = (result, result_info) => new Response(JSON.stringify({ success: true, result, ...(result_info ? { result_info } : {}) }), { headers: { 'Content-Type': 'application/json' } });
const fail = (status, code, message = 'upstream rejected request') => new Response(JSON.stringify({ success: false, errors: [{ code, message }] }), { status, headers: { 'Content-Type': 'application/json' } });

/** Stateful fake API: reruns see created resources instead of a brittle response sequence. */
function api(options = {}) {
  const state = {
    app: options.app === undefined ? ownApp() : options.app,
    policies: structuredClone(options.policies ?? [ownerPolicy()]),
    idps: structuredClone(options.idps ?? [{ id: otpId, type: 'onetimepin', name: 'Email one-time PIN' }]),
    organizationCreated: false,
    organizationBody: null,
    requests: [],
    writes: [],
  };
  const fetcher = vi.fn(async (url, init = {}) => {
    const parsed = new URL(url), path = parsed.pathname.replace(`/client/v4/accounts/${account}`, '');
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    state.requests.push({ path, method, search: parsed.search, init });
    if (method !== 'GET') state.writes.push({ path, method, body });
    if (path === '/access/organizations' && method === 'GET') {
      if (options.orgMalformed404) return new Response('not json', { status: 404 });
      if (options.orgInvalid404) return new Response(JSON.stringify({ success: true, result: null }), { status: 404 });
      if (options.orgStatus && !state.organizationCreated) return fail(options.orgStatus, options.orgCode ?? 10000, `do not expose ${token}`);
      return json(state.organizationBody ?? options.org ?? { name: 'Existing team', auth_domain: 'team.cloudflareaccess.com' });
    }
    if (path === '/access/organizations' && method === 'POST') {
      state.organizationCreated = true; state.organizationBody = body;
      if (options.orgCreateStatus) return fail(options.orgCreateStatus, 10000);
      return json(body);
    }
    if (path === '/access/identity_providers' && method === 'GET') return json(state.idps, { page: 1, total_pages: 1 });
    if (path === '/access/identity_providers' && method === 'POST') {
      const idp = { id: otpId, ...body }; state.idps.push(idp); return json(idp);
    }
    if (path === '/access/apps' && method === 'GET') {
      if (options.appPages) {
        const page = Number(parsed.searchParams.get('page') || 1);
        return json(options.appPages[page - 1] ?? [], { page, total_pages: options.appPages.length });
      }
      return json(state.app ? [state.app] : [], { page: 1, total_pages: 1 });
    }
    if (path === '/access/apps' && method === 'POST') {
      state.app = { id: appId, aud, ...body };
      state.policies = (body.policies || []).map((policy, index) => ({ id: `policy-${index}`, ...policy }));
      return json(state.app);
    }
    if (path === `/access/apps/${appId}` && method === 'GET') return json({ ...state.app, ...options.finalApp });
    if (path === `/access/apps/${appId}/policies` && method === 'GET') return json(state.policies, { page: 1, total_pages: 1 });
    if (path === `/access/apps/${appId}/policies` && method === 'POST') {
      const policy = { id: 'policy-created', ...body }; state.policies.push(policy); return json(policy);
    }
    throw new Error(`Unexpected mocked route ${method} ${path}`);
  });
  return { fetcher, state, run: (extra = {}) => setupAccess({ account, token, hostname, ownerEmail, fetcher, ...extra }) };
}

describe('Cloudflare Access setup identity and mutation boundary', () => {
  it('reuses the existing organization, OTP, application and owner policy without writes', async () => {
    const fixture = api();
    await expect(fixture.run()).resolves.toMatchObject({ access_team_domain: 'https://team.cloudflareaccess.com', access_audience: aud, app_id: appId, hostname });
    expect(fixture.state.writes).toEqual([]);
    for (const call of fixture.state.requests) {
      expect(new Headers(call.init.headers).get('Authorization')).toBe(`Bearer ${token}`);
      expect(call.init.redirect).toBe('error');
      expect(call.init.signal).toBeDefined();
    }
  });

  it('fails before any mutation when token lacks Access permission and redacts upstream secrets', async () => {
    const fixture = api({ orgStatus: 403 });
    const error = await fixture.run().catch(error => error);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/Access|permission/i);
    expect(error.message).not.toContain(token);
    expect(fixture.state.writes).toEqual([]);
    expect(fixture.fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not create or change an organization when onboarding is incomplete', async () => {
    const fixture = api({ orgStatus: 404 });
    await expect(fixture.run()).rejects.toThrow(/Zero Trust|onboard|team/i);
    expect(fixture.state.writes).toEqual([]);
  });

  it.each(['https://evil.example', 'team.cloudflareaccess.com.evil.example', 'team.cloudflareaccess.com/path'])('rejects an unexpected organization identity origin: %s', async auth_domain => {
    const fixture = api({ org: { auth_domain } });
    await expect(fixture.run()).rejects.toThrow();
    expect(fixture.state.writes).toEqual([]);
    expect(fixture.fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    { account: 'wrong' }, { token: 'bad\nheader' }, { hostname: '*.workers.dev' },
    { hostname: 'https://studio.example' }, { hostname: 'studio.example/path' },
  ])('validates configuration before making authenticated requests: %j', async input => {
    const fixture = api();
    await expect(fixture.run(input)).rejects.toThrow();
    expect(fixture.fetcher).not.toHaveBeenCalled();
  });


  it('initializes a missing organization only after explicit confirmed onboarding and verifies it through GET', async () => {
    const fixture = api({ orgStatus: 404 });
    await expect(fixture.run({ allowCreateOrganization: true })).resolves.toMatchObject({
      access_team_domain: 'https://xiexuanxi-studio.cloudflareaccess.com', access_audience: aud,
    });
    expect(fixture.state.writes).toEqual([{ method: 'POST', path: '/access/organizations', body: {
      name: 'Purrfect Studio', auth_domain: 'xiexuanxi-studio.cloudflareaccess.com',
    } }]);
    expect(fixture.state.requests.slice(0, 3).map(call => [call.method, call.path])).toEqual([
      ['GET', '/access/organizations'], ['POST', '/access/organizations'], ['GET', '/access/organizations'],
    ]);
  });

  it('preserves an existing organization even when onboarding has been explicitly confirmed', async () => {
    const fixture = api();
    await expect(fixture.run({ allowCreateOrganization: true })).resolves.toMatchObject({ access_team_domain: 'https://team.cloudflareaccess.com' });
    expect(fixture.state.writes).toEqual([]);
  });

  it.each([403, 500, 503])('does not interpret HTTP %s as permission to initialize an organization', async orgStatus => {
    const fixture = api({ orgStatus });
    await expect(fixture.run({ allowCreateOrganization: true })).rejects.toThrow();
    expect(fixture.state.writes).toEqual([]);
    expect(fixture.fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not initialize after a malformed successful organization response', async () => {
    const fixture = api({ org: {} });
    await expect(fixture.run({ allowCreateOrganization: true })).rejects.toThrow();
    expect(fixture.state.writes).toEqual([]);
    expect(fixture.fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([{ orgMalformed404: true }, { orgInvalid404: true }])('does not initialize after an unverified 404 response: %j', async invalid => {
    const fixture = api(invalid);
    await expect(fixture.run({ allowCreateOrganization: true })).rejects.toThrow();
    expect(fixture.state.writes).toEqual([]);
    expect(fixture.fetcher).toHaveBeenCalledTimes(1);
  });

  it('requires boolean confirmation instead of accepting a truthy string', async () => {
    const fixture = api({ orgStatus: 404 });
    await expect(fixture.run({ allowCreateOrganization: 'true' })).rejects.toThrow();
    expect(fixture.state.writes).toEqual([]);
  });

  it('rechecks an organization creation conflict once instead of retrying the mutation', async () => {
    const fixture = api({ orgStatus: 404, orgCreateStatus: 409 });
    await expect(fixture.run({ allowCreateOrganization: true })).resolves.toMatchObject({ access_team_domain: 'https://xiexuanxi-studio.cloudflareaccess.com' });
    expect(fixture.state.writes.filter(call => call.path === '/access/organizations')).toHaveLength(1);
  });

  it('does not retry an unsuccessful organization creation', async () => {
    const fixture = api({ orgStatus: 404, orgCreateStatus: 500 });
    await expect(fixture.run({ allowCreateOrganization: true })).rejects.toThrow();
    expect(fixture.state.requests).toHaveLength(2);
    expect(fixture.state.writes).toHaveLength(1);
  });

  it('creates only the OTP provider and exact-hostname owner application when absent', async () => {
    const fixture = api({ idps: [], app: null, policies: [] });
    const result = await fixture.run();
    expect(result.access_audience).toBe(aud);
    expect(JSON.stringify(result)).not.toContain(token);
    expect(fixture.state.writes.map(write => [write.method, write.path])).toEqual([
      ['POST', '/access/identity_providers'], ['POST', '/access/apps'],
    ]);
    expect(fixture.state.writes[0].body).toEqual({ name: 'Email one-time PIN', type: 'onetimepin', config: {} });
    expect(fixture.state.writes[1].body).toMatchObject({
      type: 'self_hosted', domain: hostname, destinations: [{ type: 'public', uri: hostname }],
      allowed_idps: [otpId], auto_redirect_to_identity: true, http_only_cookie_attribute: true,
      policies: [{ decision: 'allow', include: [{ email: { email: ownerEmail } }] }],
    });
    expect(fixture.state.requests.some(call => call.path === `/access/apps/${appId}` && call.method === 'GET')).toBe(true);
    expect(fixture.state.requests.some(call => call.path === `/access/apps/${appId}/policies` && call.method === 'GET')).toBe(true);
  });

  it('detects a hostname collision before creating any identity provider', async () => {
    const fixture = api({ idps: [], app: { ...ownApp(), name: 'Another project' } });
    await expect(fixture.run()).rejects.toThrow(/collision|another|unrelated|existing/i);
    expect(fixture.state.writes).toEqual([]);
  });

  it('checks later list pages before deciding it is safe to create the application', async () => {
    const fixture = api({ idps: [], appPages: [
      [{ ...ownApp(), id: 'other-app', domain: 'unrelated.example', destinations: [{ type: 'public', uri: 'unrelated.example' }] }],
      [{ ...ownApp(), name: 'Another project' }],
    ] });
    await expect(fixture.run()).rejects.toThrow();
    expect(fixture.state.writes).toEqual([]);
    expect(fixture.state.requests.some(call => call.path === '/access/apps' && new URLSearchParams(call.search).get('page') === '2')).toBe(true);
  });

  it('can add the missing dedicated owner policy to its existing app without altering the app or shared resources', async () => {
    const fixture = api({ policies: [] });
    await expect(fixture.run()).resolves.toMatchObject({ access_audience: aud });
    expect(fixture.state.writes).toHaveLength(1);
    expect(fixture.state.writes[0]).toMatchObject({ method: 'POST', path: `/access/apps/${appId}/policies`, body: { decision: 'allow', include: [{ email: { email: ownerEmail } }] } });
  });

  it.each(['bypass', 'service_auth', 'allow'])('rejects an unrelated granting policy (%s) without changing it', async decision => {
    const fixture = api({ policies: [ownerPolicy(), { id: 'unexpected-policy', name: 'Someone else', decision, include: [{ everyone: {} }], exclude: [], require: [] }] });
    await expect(fixture.run()).rejects.toThrow();
    expect(fixture.state.writes).toEqual([]);
  });

  it('preserves a restrictive Deny policy alongside the intended owner policy', async () => {
    const fixture = api({ policies: [ownerPolicy(), { id: 'deny-policy', name: 'Restrict', decision: 'deny', include: [{ email_domain: { domain: 'invalid.example' } }] }] });
    await expect(fixture.run()).resolves.toMatchObject({ access_audience: aud });
    expect(fixture.state.writes).toEqual([]);
  });

  it.each([
    { domain: 'other.example' }, { aud: 'invalid' }, { allowed_idps: [otpId, 'other-idp'] },
    { destinations: [{ type: 'public', uri: hostname }, { type: 'public', uri: 'other.example' }] },
  ])('verifies the final provider configuration instead of trusting a create response: %j', async finalApp => {
    const fixture = api({ finalApp });
    await expect(fixture.run()).rejects.toThrow();
    expect(fixture.state.writes).toEqual([]);
  });
});
