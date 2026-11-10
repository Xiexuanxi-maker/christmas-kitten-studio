import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface AuthConfig { ACCESS_TEAM_DOMAIN?:string; ACCESS_AUDIENCE?:string; ADMIN_EMAIL:string }
const keysets = new Map<string,ReturnType<typeof createRemoteJWKSet>>();
export function accessIssuer(domain?:string) {
  if(!domain) return null;
  const clean=domain.replace(/^https:\/\//,'').replace(/\/$/,'');
  if(!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(clean)) return null;
  return `https://${clean}`;
}
export async function authenticate(token:string|undefined, env:AuthConfig):Promise<{email:string;role:'admin'}|null> {
  const issuer=accessIssuer(env.ACCESS_TEAM_DOMAIN);
  const admin=typeof env.ADMIN_EMAIL==='string'?env.ADMIN_EMAIL.trim().toLowerCase():'';
  if(!token || !issuer || !env.ACCESS_AUDIENCE || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(admin)) return null;
  try {
    let keys=keysets.get(issuer);
    if(!keys) {keys=createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));keysets.set(issuer,keys);}
    const {payload}=await jwtVerify(token,keys,{issuer,audience:env.ACCESS_AUDIENCE,algorithms:['RS256']});
    const email=typeof payload.email==='string'?payload.email.toLowerCase():'';
    if(!email || email!==admin) return null;
    return {email,role:'admin'};
  }catch {return null;}
}
