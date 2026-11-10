import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ verify: vi.fn(), keyset: vi.fn(() => 'remote-keyset') }));
vi.mock('jose', () => ({ jwtVerify: mocks.verify, createRemoteJWKSet: mocks.keyset }));
import { accessIssuer, authenticate } from '../worker/auth';

const env = {
  ADMIN_EMAIL: 'xiexuanxi@outlook.fr',
  ACCESS_TEAM_DOMAIN: 'kitten-studio.cloudflareaccess.com',
  ACCESS_AUDIENCE: 'expected-application-audience',
};
beforeEach(() => { mocks.verify.mockReset(); mocks.keyset.mockClear(); });

describe('Cloudflare Access authentication', () => {
  it('fails closed when the assertion or Access configuration is missing', async () => {
    await expect(authenticate(undefined, env)).resolves.toBeNull();
    await expect(authenticate('assertion', { ...env, ACCESS_TEAM_DOMAIN: '' })).resolves.toBeNull();
    await expect(authenticate('assertion', { ...env, ACCESS_AUDIENCE: '' })).resolves.toBeNull();
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it('pins the issuer, application audience and RSA algorithm before accepting the administrator', async () => {
    mocks.verify.mockResolvedValue({ payload: { email: 'XieXuanXi@Outlook.fr' } });
    await expect(authenticate('signed-access-assertion', env)).resolves.toEqual({ email: env.ADMIN_EMAIL, role: 'admin' });
    expect(mocks.verify).toHaveBeenCalledWith('signed-access-assertion', 'remote-keyset', {
      issuer: 'https://kitten-studio.cloudflareaccess.com',
      audience: env.ACCESS_AUDIENCE,
      algorithms: ['RS256'],
    });
  });

  it('rejects a valid assertion for another email instead of assigning an administrator role', async () => {
    mocks.verify.mockResolvedValue({ payload: { email: 'visitor@example.com' } });
    await expect(authenticate('assertion', env)).resolves.toBeNull();
  });

  it('rejects missing email claims and an empty administrator configuration', async () => {
    mocks.verify.mockResolvedValue({ payload: {} });
    await expect(authenticate('assertion', env)).resolves.toBeNull();
    await expect(authenticate('assertion', { ...env, ADMIN_EMAIL: '' })).resolves.toBeNull();
  });

  it.each(['expired token', 'invalid audience', 'invalid signature'])('fails closed after verification reports %s', async (reason) => {
    mocks.verify.mockRejectedValue(new Error(reason));
    await expect(authenticate('invalid-assertion', env)).resolves.toBeNull();
  });
});

describe('Access issuer configuration', () => {
  it('normalizes a valid team origin without allowing another identity host', () => {
    expect(accessIssuer('https://team.cloudflareaccess.com/')).toBe('https://team.cloudflareaccess.com');
    for (const value of [undefined, '', 'evil.example', 'team.cloudflareaccess.com.evil.example', 'http://team.cloudflareaccess.com', 'team.cloudflareaccess.com/path', 'team.cloudflareaccess.com@evil.example']) {
      expect(accessIssuer(value)).toBeNull();
    }
  });
});
