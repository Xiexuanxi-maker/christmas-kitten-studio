/** Configure only this application's Access gate. Credentials never leave the API client. */
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_NAME = 'Christmas Kitten Studio';
const POLICY_NAME = 'Kitten Studio administrator';
const PERMISSIONS = 'Cloudflare Access denied this request. Check the account Access Edit permissions and Zero Trust activation.';
const ONBOARDING = 'Complete Cloudflare Zero Trust onboarding, including the team domain, before configuring email login.';
const id = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9-]{0,199}$/.test(value);
const audience = value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
const array = value => Array.isArray(value) ? value : [];
const emptyRules = value => value === undefined || (Array.isArray(value) && value.length === 0);
export class AccessSetupError extends Error { constructor(message, status) { super(message); this.name = 'AccessSetupError'; this.status = status; } }
const fail = (message, status) => { throw new AccessSetupError(message, status); };

function validateApp(app, hostname, otpId) {
  if (!app || !id(app.id) || app.name !== APP_NAME || app.type !== 'self_hosted' || app.domain !== hostname)
    fail('The planned hostname belongs to a different Access application. Existing applications were preserved.');
  if (app.destinations !== undefined && (!Array.isArray(app.destinations) || !app.destinations.length
    || app.destinations.some(destination => destination.type !== 'public' || destination.uri !== hostname)))
    fail('The existing Access application has other destinations. Review its configuration manually.');
  if (array(app.allowed_idps).length !== 1 || app.allowed_idps[0] !== otpId
    || app.auto_redirect_to_identity !== true || app.http_only_cookie_attribute !== true)
    fail('The existing Access application does not match the required email login configuration.');
}
function ownerPolicy(policy, email) {
  return policy.name === POLICY_NAME && policy.decision === 'allow'
    && array(policy.include).length === 1 && typeof policy.include[0]?.email?.email === 'string'
    && policy.include[0].email.email.toLowerCase() === email
    && Object.keys(policy.include[0]).length === 1 && Object.keys(policy.include[0].email).length === 1
    && emptyRules(policy.exclude) && emptyRules(policy.require);
}
function checkPolicies(policies, email) {
  if (policies.some(policy => !ownerPolicy(policy, email) && policy.decision !== 'deny'))
    fail('The Access application has an unrelated Allow, Bypass, or Service Auth policy. Existing policies were preserved.');
  const owners = policies.filter(policy => ownerPolicy(policy, email));
  if (owners.length > 1) fail('Duplicate administrator policies require manual review.');
  return owners[0];
}

export async function setupAccess({ account, token, hostname, ownerEmail = 'xiexuanxi@outlook.fr', allowCreateOrganization = false, fetcher = globalThis.fetch }) {
  account = account?.trim(); token = token?.trim(); ownerEmail = ownerEmail?.trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/i.test(account || '') || !token || /[\r\n]/.test(token)) fail('Valid Cloudflare account credentials are required.');
  if (!/^christmas-kitten-studio\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.workers\.dev$/.test(hostname || ''))
    fail('The exact prepared Christmas Kitten workers.dev hostname is required.');
  if (ownerEmail !== 'xiexuanxi@outlook.fr') fail('The administrator email must remain xiexuanxi@outlook.fr.');
  const base = `https://api.cloudflare.com/client/v4/accounts/${account}`;
  async function api(path, method = 'GET', body) {
    let response, data;
    try {
      response = await fetcher(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(30000) });
      data = await response.json();
    } catch { fail('Cloudflare Access could not be reached or returned an invalid response.'); }
    const explicitNotEnabled = path === '/access/organizations' && method === 'GET'
      && response.status === 403 && data?.success === false && Array.isArray(data.errors)
      && data.errors.length === 1 && data.errors[0]?.code === 9999
      && typeof data.errors[0]?.message === 'string'
      && data.errors[0].message.split(':')[0].trim() === 'access.api.error.not_enabled';
    // Access also uses this documented service-initialization marker before a team exists.
    // It is distinct from an authorization failure; user-confirmed onboarding is still required.
    if (explicitNotEnabled) fail(ONBOARDING, 403);
    if (response.status === 401 || response.status === 403) {
      const codes = array(data?.errors).map(error => Number.isInteger(error?.code) ? error.code : 'unknown').join(',') || 'unknown';
      fail(`${PERMISSIONS} (${method} ${path.split('?')[0]}; HTTP ${response.status}; codes ${codes}).`, response.status);
    }
    if (path === '/access/organizations' && method === 'GET' && response.status === 404
      && data?.success === false && Array.isArray(data.errors)) fail(ONBOARDING, 404);
    if (!response.ok || data?.success !== true) {
      const codes = array(data?.errors).map(error => Number.isInteger(error?.code) ? error.code : 'unknown').join(',') || 'unknown';
      fail(`Cloudflare Access request failed (HTTP ${response.status}; codes ${codes}).`, response.status);
    }
    return data;
  }
  async function list(path) {
    const items = [];
    for (let page = 1; page <= 100; page++) {
      const data = await api(`${path}?page=${page}&per_page=100`);
      if (!Array.isArray(data.result)) fail('Cloudflare Access returned an invalid resource list.');
      items.push(...data.result);
      const pages = data.result_info?.total_pages;
      if (Number.isInteger(pages) && pages >= 0) { if (page >= pages) return items; }
      else if (data.result.length < 100) return items;
    }
    fail('Cloudflare Access pagination exceeded the preparation limit.');
  }
  let organization;
  try { organization = (await api('/access/organizations')).result; }
  catch (error) {
    // The user must already have completed the separate subscription/terms checkout.
    // Never infer onboarding or authorize creation from a permission/network failure.
    if (!(error instanceof AccessSetupError && [403, 404].includes(error.status) && error.message === ONBOARDING && allowCreateOrganization === true)) throw error;
    try { await api('/access/organizations', 'POST', { name: 'Purrfect Studio', auth_domain: 'xiexuanxi-studio.cloudflareaccess.com' }); }
    catch (creationError) {
      // Another request may have initialized the organization in the meantime.
      if (!(creationError instanceof AccessSetupError && creationError.status === 409)) throw creationError;
    }
    organization = (await api('/access/organizations')).result;
  }
  const team = organization?.auth_domain;
  if (typeof team !== 'string' || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(team)) fail(ONBOARDING);
  const providers = await list('/access/identity_providers');
  const apps = await list('/access/apps');
  const matches = apps.filter(app => app.domain === hostname || array(app.destinations).some(destination => destination.uri === hostname));
  if (matches.length > 1) fail('Multiple Access applications already claim the planned hostname. Review them manually.');
  let app = matches[0], otp;
  if (app) {
    if (!id(app.id) || app.name !== APP_NAME || app.type !== 'self_hosted')
      fail('The planned hostname belongs to a different Access application. Existing applications were preserved.');
    app = (await api(`/access/apps/${app.id}`)).result;
    otp = providers.find(provider => provider.type === 'onetimepin' && provider.id === app?.allowed_idps?.[0]);
    if (!otp || !id(otp.id)) fail('The existing Access application does not use a known email one-time PIN provider.');
    validateApp(app, hostname, otp.id);
  } else otp = providers.find(provider => provider.type === 'onetimepin' && id(provider.id));
  const policy = { name: POLICY_NAME, decision: 'allow', precedence: 1, include: [{ email: { email: ownerEmail } }], exclude: [], require: [] };
  if (app) {
    const policies = await list(`/access/apps/${app.id}/policies`);
    if (!checkPolicies(policies, ownerEmail)) await api(`/access/apps/${app.id}/policies`, 'POST', policy);
  } else {
    if (!otp) {
      otp = (await api('/access/identity_providers', 'POST', { name: 'Email one-time PIN', type: 'onetimepin', config: {} })).result;
      if (!id(otp?.id) || otp.type !== 'onetimepin') fail('Cloudflare Access did not confirm a valid email one-time PIN provider.');
    }
    app = (await api('/access/apps', 'POST', { name: APP_NAME, type: 'self_hosted', domain: hostname,
      destinations: [{ type: 'public', uri: hostname }], allowed_idps: [otp.id], auto_redirect_to_identity: true,
      app_launcher_visible: true, http_only_cookie_attribute: true, session_duration: '24h', policies: [policy] })).result;
    if (!id(app?.id)) fail('Cloudflare Access did not return a valid application ID.');
  }
  app = (await api(`/access/apps/${app.id}`)).result;
  validateApp(app, hostname, otp.id);
  if (!audience(app.aud)) fail('Cloudflare Access did not return a valid application audience.');
  const verifiedPolicy = checkPolicies(await list(`/access/apps/${app.id}/policies`), ownerEmail);
  if (!verifiedPolicy) fail('Cloudflare Access did not confirm the administrator email policy.');
  return { access_team_domain: `https://${team}`, access_audience: app.aud, app_id: app.id, hostname,
    ...(id(verifiedPolicy.id) ? { policy_id: verifiedPolicy.id } : {}) };
}

export async function main() {
  try {
    const inspection = JSON.parse(await readFile('cloudflare-inspection.json', 'utf8'));
    const result = await setupAccess({ account: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_API_TOKEN, hostname: inspection.app_hostname,
      allowCreateOrganization: process.env.ZERO_TRUST_ONBOARDING_CONFIRMED === 'true' });
    const path = fileURLToPath(new URL('../wrangler.jsonc', import.meta.url));
    const config = JSON.parse(await readFile(path, 'utf8'));
    config.vars = { ...config.vars, ACCESS_TEAM_DOMAIN: result.access_team_domain, ACCESS_AUDIENCE: result.access_audience };
    await writeFile(path, JSON.stringify(config, null, 2) + '\n');
    await writeFile('access-setup.json', JSON.stringify(result, null, 2) + '\n');
    console.log(`Access team: ${result.access_team_domain}`);
    console.log(`Access audience: ${result.access_audience}`);
    console.log(`Owner-only email login configured for ${result.hostname}. No application deployment was performed.`);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
      `## Email login prepared\n\nHostname: \`${result.hostname}\`\n\nAdministrator: xiexuanxi@outlook.fr\n\nTeam: ${result.access_team_domain}\n\nAudience: \`${result.access_audience}\`\n`);
  } catch (error) {
    console.error(error instanceof AccessSetupError ? error.message : 'Could not read or save Cloudflare Access setup metadata.');
    process.exitCode = 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
