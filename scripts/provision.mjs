#!/usr/bin/env node
/** Explicitly run this AFTER configuring account credentials in a secure environment.
 * No secrets are written to disk or printed. Resource IDs and binding names are public configuration.
 * --configure-only is for CI: validate supplied resource/Access vars, without API calls.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const configureOnly = process.argv.includes('--configure-only');
const env = process.env;
const file = fileURLToPath(new URL('../wrangler.jsonc', import.meta.url));
const config = JSON.parse(await readFile(file, 'utf8'));
const account = env.CLOUDFLARE_ACCOUNT_ID;
const token = env.CLOUDFLARE_API_TOKEN;
const databaseName = 'kitten-studio';
const bucketName = env.R2_BUCKET_NAME || config.r2_buckets[0].bucket_name;
let databaseId = env.D1_DATABASE_ID;

function required(name) {
  if (!env[name]?.trim()) throw new Error(`${name} is required; add it to GitHub production environment configuration.`);
  return env[name].trim();
}
function validateAccess() {
  const domain = required('ACCESS_TEAM_DOMAIN').replace(/\/$/, '');
  const audience = required('ACCESS_AUDIENCE');
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/i.test(domain)) {
    throw new Error('ACCESS_TEAM_DOMAIN must be https://YOURTEAM.cloudflareaccess.com');
  }
  if (!/^[a-f0-9]{64}$/i.test(audience)) throw new Error('ACCESS_AUDIENCE must be the 64-character Access application AUD.');
  config.vars.ACCESS_TEAM_DOMAIN = domain;
  config.vars.ACCESS_AUDIENCE = audience;
}
async function api(path, init = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, {
    ...init,
    headers: {'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json'},
  });
  let result;
  try { result = await response.json(); } catch { throw new Error(`Cloudflare returned HTTP ${response.status} without JSON.`); }
  if (!response.ok || !result.success) {
    // Cloudflare error codes are safe to print; response bodies may contain account data.
    const codes = (result.errors || []).map(error => error.code).join(', ') || 'unknown';
    throw new Error(`Cloudflare ${path.split('?')[0]} failed (HTTP ${response.status}; codes ${codes}).`);
  }
  return result.result;
}

try {
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucketName)) throw new Error('R2_BUCKET_NAME must be a valid 3–63 character bucket name.');
  if (configureOnly) {
    validateAccess();
    if (!databaseId || databaseId === '00000000-0000-0000-0000-000000000000' || !/^[a-f0-9-]{36}$/i.test(databaseId)) {
      throw new Error('D1_DATABASE_ID must be the actual D1 database UUID from provisioning.');
    }
  } else {
    if (!account || !/^[a-f0-9]{32}$/i.test(account) || !token) throw new Error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in the secure environment first.');
    const databases = await api(`/d1/database?name=${encodeURIComponent(databaseName)}&per_page=100`);
    let database = databases.find(item => item.name === databaseName);
    if (!database) database = await api('/d1/database', {method:'POST', body:JSON.stringify({name:databaseName})});
    databaseId = database.uuid;
    if (!databaseId) throw new Error('Cloudflare did not return the D1 database UUID.');
    const buckets = await api('/r2/buckets?per_page=1000');
    if (!(buckets.buckets || []).some(item => item.name === bucketName)) {
      await api('/r2/buckets', {method:'POST', body:JSON.stringify({name:bucketName})});
    }
    if (env.ACCESS_TEAM_DOMAIN || env.ACCESS_AUDIENCE) validateAccess();
  }
  config.d1_databases[0].database_id = databaseId;
  config.r2_buckets[0].bucket_name = bucketName;
  config.vars.ADMIN_EMAIL = 'xiexuanxi@outlook.fr';
  if (env.SEEDANCE_MODEL?.trim()) config.vars.SEEDANCE_MODEL = env.SEEDANCE_MODEL.trim();
  if (env.APP_HOSTNAME?.trim()) {
    const hostname = env.APP_HOSTNAME.trim().toLowerCase();
    if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(hostname) || hostname.endsWith('.workers.dev')) {
      throw new Error('APP_HOSTNAME must be a custom hostname in your Cloudflare DNS zone. Omit it to use workers.dev.');
    }
    config.workers_dev = false;
    config.routes = [{pattern:hostname, custom_domain:true}];
  }
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`Configured D1 ${databaseName}: ${databaseId}`);
  console.log(`Configured private R2 bucket: ${bucketName}`);
  console.log('Configuration saved; no deployment was performed.');
  if (!config.vars.ACCESS_TEAM_DOMAIN || !config.vars.ACCESS_AUDIENCE) {
    console.log('Next: create Cloudflare Access OTP application, then set ACCESS_TEAM_DOMAIN and ACCESS_AUDIENCE. API routes remain locked until configured.');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
