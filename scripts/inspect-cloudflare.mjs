/** Run inside GitHub Actions with secrets; artifacts contain only public setup metadata. */
import { writeFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const validSubdomain = value => typeof value === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value);
const emptyResult = message => ({ workers_subdomain: null, app_hostname: null, message });
const codes = data => Array.isArray(data?.errors)
  ? data.errors.map(error => Number.isInteger(error?.code) ? error.code : 'unknown').join(',') || 'unknown'
  : 'unknown';
const resultFor = subdomain => ({ workers_subdomain: subdomain, app_hostname: `christmas-kitten-studio.${subdomain}.workers.dev` });

/** Register a domain only when Cloudflare explicitly confirms no account domain exists. */
export async function inspectCloudflare({ account, token, owner = 'Xiexuanxi-maker', fetcher = globalThis.fetch }) {
  account = account?.trim();
  token = token?.trim();
  if (!account || !/^[a-f0-9]{32}$/i.test(account)) throw new Error('CLOUDFLARE_ACCOUNT_ID is missing or invalid.');
  if (!token || /[\r\n]/.test(token)) throw new Error('CLOUDFLARE_API_TOKEN is missing or invalid.');
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/subdomain`;
  const headers = { Authorization: `Bearer ${token}` };
  let response, data;
  try {
    response = await fetcher(url, { headers, signal: AbortSignal.timeout(30000), redirect: 'error' });
    data = await response.json().catch(() => null);
  } catch {
    return emptyResult('Could not inspect Cloudflare. Resource preparation will check credentials next.');
  }
  if (response.ok && data?.success === true && validSubdomain(data.result?.subdomain)) return resultFor(data.result.subdomain);
  // Official Wrangler also treats code 10007 as an unregistered account subdomain.
  // A generic 404, denial, or malformed response never authorizes a mutation.
  const missing = response.status === 404 && data?.success === false
    && Array.isArray(data.errors) && data.errors.length === 1 && data.errors[0]?.code === 10007;
  if (!missing) return emptyResult(`Workers subdomain is not available yet (HTTP ${response.status}; codes ${codes(data)}). Resource preparation will continue.`);

  const candidate = typeof owner === 'string' && validSubdomain(owner.toLowerCase()) ? owner.toLowerCase() : 'xiexuanxi-maker';
  try {
    response = await fetcher(url, {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ subdomain: candidate }), signal: AbortSignal.timeout(30000), redirect: 'error',
    });
    data = await response.json().catch(() => null);
    if (response.ok && data?.success === true) {
      if (validSubdomain(data.result?.subdomain)) return resultFor(data.result.subdomain);
      // A successful mutation without its domain is not enough to invent a URL.
      response = await fetcher(url, { headers, signal: AbortSignal.timeout(30000), redirect: 'error' });
      data = await response.json().catch(() => null);
      if (response.ok && data?.success === true && validSubdomain(data.result?.subdomain)) return resultFor(data.result.subdomain);
    }
    return { ...emptyResult(`Workers subdomain could not be registered (HTTP ${response.status}; codes ${codes(data)}). Register one in Cloudflare Workers & Pages to continue.`), registration_failed: true };
  } catch {
    return { ...emptyResult('Workers subdomain could not be registered. Register one in Cloudflare Workers & Pages to continue.'), registration_failed: true };
  }
}

export async function main() {
  try {
    const result = await inspectCloudflare({
      account: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_API_TOKEN,
      owner: process.env.GITHUB_REPOSITORY_OWNER,
    });
    const metadata = { workers_subdomain: result.workers_subdomain, app_hostname: result.app_hostname };
    await writeFile('cloudflare-inspection.json', JSON.stringify(metadata, null, 2) + '\n');
    if (result.workers_subdomain) {
      console.log(`Workers hostname: ${result.app_hostname}`);
      if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
        `## Cloudflare setup\n\nPlanned app hostname: \`${result.app_hostname}\`\n\nThis preparation does not publish the application.\n`);
    } else console.log(result.message);
    if (result.registration_failed) process.exitCode = 1;
  } catch (error) {
    const safe = error instanceof Error && /^CLOUDFLARE_(?:ACCOUNT_ID|API_TOKEN) is missing or invalid\.$/.test(error.message)
      ? error.message : 'Could not save Cloudflare setup metadata.';
    console.log(safe);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
