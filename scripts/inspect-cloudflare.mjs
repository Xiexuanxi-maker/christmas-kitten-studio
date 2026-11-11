/** Run inside GitHub Actions with secrets; never return credentials to chat or artifacts. */
import { writeFile, appendFile } from 'node:fs/promises';
const account=process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
const token=process.env.CLOUDFLARE_API_TOKEN?.trim();
try {
  if(!account||!/^[a-f0-9]{32}$/i.test(account))throw new Error('CLOUDFLARE_ACCOUNT_ID is missing or invalid.');
  if(!token||/[\r\n]/.test(token))throw new Error('CLOUDFLARE_API_TOKEN is missing or invalid.');
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/subdomain`,{
    headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000),redirect:'error',
  });
  const data=await response.json().catch(()=>null);
  const subdomain=data?.success&&typeof data.result?.subdomain==='string'&&/^[a-z0-9-]+$/.test(data.result.subdomain)?data.result.subdomain:null;
  const result={workers_subdomain:subdomain,app_hostname:subdomain?`christmas-kitten-studio.${subdomain}.workers.dev`:null};
  await writeFile('cloudflare-inspection.json',JSON.stringify(result,null,2)+'\n');
  if(subdomain){
    console.log(`Workers hostname: ${result.app_hostname}`);
    if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,`## Cloudflare setup\n\nPlanned app hostname: \`${result.app_hostname}\`\n\nThis preparation does not publish the application.\n`);
  }else{
    const codes=Array.isArray(data?.errors)?data.errors.map(e=>Number.isInteger(e.code)?e.code:'unknown').join(','):'unknown';
    console.log(`Workers subdomain is not available yet (HTTP ${response.status}; codes ${codes}). Resource preparation will continue.`);
  }
}catch(error){
  // Network error bodies and upstream messages can include credentials. Only fixed messages escape.
  const safe=error instanceof Error&&error.message.startsWith('CLOUDFLARE_')?error.message:'Could not inspect Cloudflare. Resource preparation will check credentials next.';
  console.log(safe);
  if(safe.startsWith('CLOUDFLARE_'))process.exitCode=1;
}
