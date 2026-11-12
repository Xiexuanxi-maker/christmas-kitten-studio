/** Read-only status checks; neither token values nor upstream response bodies are logged. */
const account=process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
const token=process.env.CLOUDFLARE_API_TOKEN?.trim();
if(!account||!/^[a-f0-9]{32}$/i.test(account)||!token||/[\r\n]/.test(token)){
  console.log('Cloudflare diagnostic credentials are missing or invalid.');process.exitCode=1;
}else{
  const paths=[
    ['/user/tokens/verify','User token verification'],
    [`/accounts/${account}/tokens/verify`,'Account token verification'],
    [`/accounts/${account}/access/organizations`,'Access organization'],
    [`/accounts/${account}/access/identity_providers`,'Access identity providers'],
    [`/accounts/${account}/access/apps`,'Access applications'],
  ];
  for(const [path,label]of paths){
    try{
      const response=await fetch(`https://api.cloudflare.com/client/v4${path}`,{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(20000)});
      const data=await response.json().catch(()=>null);
      const codes=Array.isArray(data?.errors)?data.errors.map(e=>Number.isInteger(e?.code)?e.code:'unknown').join(',')||'none':'none';
      const messages=Array.isArray(data?.errors)?data.errors.map(e=>typeof e?.message==='string'?e.message.toLowerCase():''):[];
      const kind=messages.some(m=>/authenticat|authoriz|forbidden|permission/.test(m))?'authorization':messages.some(m=>/not found|does not exist|no organization/.test(m))?'not_found':messages.some(m=>/subscription|billing|activate|enable/.test(m))?'activation':codes==='none'?'none':'other';
      const status=data?.result?.status;
      const active=['active','disabled','expired'].includes(status)?`; token status ${status}`:'';
      console.log(`${label}: HTTP ${response.status}; success ${data?.success===true}; codes ${codes}; error category ${kind}${active}`);
    }catch{console.log(`${label}: request could not be completed.`);}
  }
}
