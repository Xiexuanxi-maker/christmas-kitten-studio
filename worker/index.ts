import { Hono } from 'hono';
import { generateText } from 'ai';
import { createAI } from 'agents/models/ai-sdk';
import { z } from 'zod';
import { initialShots } from '../src/storyboard';
import { authenticate, accessIssuer } from './auth';
import { createTask, getTask } from './seedance';

export interface Env {
  ASSETS:Fetcher; DB:D1Database; MEDIA:R2Bucket; AI:Ai;
  ADMIN_EMAIL:string; ACCESS_TEAM_DOMAIN?:string; ACCESS_AUDIENCE?:string;
  ARK_API_KEY?:string; SEEDANCE_MODEL?:string;
}
type User={email:string;role:'admin'};
const app=new Hono<{Bindings:Env;Variables:{user:User}}>();
const shotSchema=z.object({id:z.string().max(80),title:z.string().min(1).max(160),start:z.number().min(0).max(40),end:z.number().min(0).max(40),subtitle:z.string().max(300),prompt:z.string().min(1).max(6000),audio:z.string().max(1000),category:z.string().max(100),kitten:z.string().optional(),image:z.string().max(2000)}).refine(s=>s.end>s.start);
const shotsSchema=z.array(shotSchema).length(12).refine(shots=>shots.every((s,i)=>s.id===initialShots[i].id&&s.start===initialShots[i].start&&s.end===initialShots[i].end),'Keep the original V2 40-second timeline.');
const now=()=>new Date().toISOString();
function configured(env:Env){return {seedance:!!env.ARK_API_KEY,ai:!!env.AI,database:!!env.DB,storage:!!env.MEDIA,access:!!(accessIssuer(env.ACCESS_TEAM_DOMAIN)&&env.ACCESS_AUDIENCE)};}
function loginUrl(request:Request){return new URL('/cdn-cgi/access/login',request.url).toString();}
app.use('/api/*',async(c,next)=>{
  c.header('Cache-Control','no-store');
  c.header('X-Content-Type-Options','nosniff');
  if(!['GET','HEAD'].includes(c.req.method)) {
    const origin=c.req.header('origin');
    if((origin&&origin!==new URL(c.req.url).origin)||c.req.header('sec-fetch-site')==='cross-site') return c.json({error:'Cross-origin requests are not allowed.'},403);
  }
  if(c.req.path==='/api/health')return next();
  const user=await authenticate(c.req.header('Cf-Access-Jwt-Assertion'),c.env);
  if(c.req.path==='/api/session') return c.json({authenticated:!!user,email:user?.email??null,role:user?.role??null,configured:configured(c.env),loginUrl:loginUrl(c.req.raw)});
  if(!user)return c.json({error:'Sign in with the configured administrator email through Cloudflare Access.',loginUrl:loginUrl(c.req.raw)},401);
  c.set('user',user);return next();
});
app.get('/api/health',c=>c.json({ok:true,service:'purrfect-studio'}));
app.get('/api/project',async c=>{
  const row=await c.env.DB.prepare('SELECT shots,updated_at FROM projects WHERE id=? AND owner=?').bind('christmas-v2',c.get('user').email).first<{shots:string;updated_at:string}>();
  return c.json({shots:row?JSON.parse(row.shots):initialShots,updated_at:row?.updated_at??null});
});
app.put('/api/project',async c=>{
  const parsed=z.object({shots:shotsSchema}).safeParse(await c.req.json());
  if(!parsed.success)return c.json({error:'Invalid storyboard. Preserve all 12 shots and the V2 timing.'},400);
  const timestamp=now();
  await c.env.DB.prepare('INSERT INTO projects(id,owner,shots,updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET shots=excluded.shots,updated_at=excluded.updated_at WHERE projects.owner=excluded.owner').bind('christmas-v2',c.get('user').email,JSON.stringify(parsed.data.shots),timestamp).run();
  return c.json({saved:true,updated_at:timestamp});
});
app.post('/api/enhance',async c=>{
  if(!c.env.AI)return c.json({error:'Cloudflare Workers AI binding is not configured.'},503);
  const parsed=z.object({shot:shotSchema,instruction:z.string().max(1000).optional()}).safeParse(await c.req.json());
  if(!parsed.success)return c.json({error:'Invalid shot.'},400);
  const ai=createAI({binding:c.env.AI});
  const result=await generateText({model:ai('@cf/meta/llama-3.3-70b-instruct-fp8-fast'),maxOutputTokens:1600,system:'You are a product film director. Return only an English Seedance video prompt, no markdown. Preserve the exact shot subject and action, clear premium acrylic Christmas kitten advent calendar, burgundy bow, golden fixtures, cozy Christmas bokeh, photorealistic macro product film, vertical 9:16. Describe camera movement, lighting, tactile material detail and subtle ASMR. No new cats, no montage, no added shots. Do not render text in video: English subtitles will be added in editing. No invented product specifications.',prompt:JSON.stringify(parsed.data)});
  return c.json({prompt:result.text.trim()});
});
type Job={id:string;owner:string;shot_id:string;prompt:string;duration:number;status:string;provider_id:string|null;video_key:string|null;error:string|null;created_at:string;updated_at:string};
function publicJob(j:Job){return {id:j.id,shot_id:j.shot_id,status:j.status,duration:j.duration,video_url:j.video_key?`/api/media/${j.video_key}`:null,error:j.error,created_at:j.created_at};}
app.get('/api/generations',async c=>{
  const result=await c.env.DB.prepare('SELECT * FROM generations WHERE owner=? ORDER BY created_at DESC LIMIT 100').bind(c.get('user').email).all<Job>();
  return c.json({jobs:result.results.map(publicJob)});
});
app.post('/api/generations',async c=>{
  if(!c.env.ARK_API_KEY||!c.env.MEDIA)return c.json({error:'Configure the Seedance API secret and Cloudflare R2 before generating.'},503);
  const parsed=z.object({shotId:z.string(),prompt:z.string().min(20).max(4800),audio:z.string().max(1000).optional(),duration:z.number().positive().max(15),ratio:z.literal('9:16')}).safeParse(await c.req.json());
  if(!parsed.success)return c.json({error:'Invalid generation request.'},400);
  const shot=initialShots.find(s=>s.id===parsed.data.shotId);
  if(!shot)return c.json({error:'Unknown V2 shot.'},400);
  const id=crypto.randomUUID(),owner=c.get('user').email,timestamp=now();
  // Atomic capacity reservation: at most three billable upstream tasks at a time.
  const reserved=await c.env.DB.prepare("INSERT INTO generations(id,owner,shot_id,prompt,duration,status,created_at,updated_at) SELECT ?,?,?,?,?,'submitting',?,? WHERE (SELECT count(*) FROM generations WHERE owner=? AND status IN ('submitting','queued','running','saving'))<3").bind(id,owner,shot.id,parsed.data.prompt,shot.end-shot.start,timestamp,timestamp,owner).run();
  if(!reserved.meta.changes)return c.json({error:'Three clips are already active. Refresh them before creating another.'},429);
  try {
    const sourcePrompt=`${parsed.data.prompt}\n\nAudio direction: ${parsed.data.audio??shot.audio} No spoken dialogue. Do not render captions or text in video; subtitles will be added in editing.`;
    const task=await createTask(c.env.ARK_API_KEY,c.env.SEEDANCE_MODEL||'doubao-seedance-2-0-260128',sourcePrompt,shot.end-shot.start);
    await c.env.DB.prepare('UPDATE generations SET provider_id=?,status=?,updated_at=? WHERE id=?').bind(task.id,task.status||'queued',now(),id).run();
    return c.json({id,shot_id:shot.id,status:task.status||'queued'},201);
  }catch {
    // A timeout may happen after the provider accepted the task. Do not retry automatically.
    await c.env.DB.prepare("UPDATE generations SET status='failed',error=?,updated_at=? WHERE id=?").bind('Submission could not be confirmed. Check the Ark console before retrying to avoid a duplicate charge.',now(),id).run();
    return c.json({error:'Seedance submission failed or timed out. Check Ark before retrying.',id},502);
  }
});
app.post('/api/generations/:id/refresh',async c=>{
  const job=await c.env.DB.prepare('SELECT * FROM generations WHERE id=? AND owner=?').bind(c.req.param('id'),c.get('user').email).first<Job>();
  if(!job)return c.json({error:'Clip not found.'},404);
  if(job.video_key||!job.provider_id)return c.json(publicJob(job));
  if(!c.env.ARK_API_KEY)return c.json({error:'Seedance is not configured.'},503);
  const task=await getTask(c.env.ARK_API_KEY,job.provider_id);
  let status:string=task.status,key=job.video_key,error=task.error?.message?.slice(0,500)??null;
  if(status==='succeeded'&&task.content?.video_url){
    const url=new URL(task.content.video_url);
    if(url.protocol!=='https:'||url.hostname==='localhost'||/^[\d.]+$/.test(url.hostname))throw new Error('Invalid provider download URL');
    try{
      const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(90000)});
      if(!response.ok||!response.body)throw new Error('Provider download unavailable');
      const size=Number(response.headers.get('content-length')||0);
      if(size>200*1024*1024)throw new Error('Clip too large');
      key=`generated/${job.owner}/${job.id}.mp4`;
      await c.env.MEDIA.put(key,response.body,{httpMetadata:{contentType:'video/mp4'},customMetadata:{owner:job.owner,shotId:job.shot_id}});
    }catch{key=null;status='saving';error='Clip generated. R2 transfer failed; refresh again within 24 hours to retry.';}
  } else if(status==='succeeded'){status='failed';error='The provider returned no downloadable video.';}
  await c.env.DB.prepare('UPDATE generations SET status=?,video_key=?,error=?,updated_at=? WHERE id=?').bind(status,key,error,now(),job.id).run();
  return c.json(publicJob({...job,status,video_key:key,error}));
});
app.get('/api/assets',async c=>{
  const r=await c.env.DB.prepare('SELECT * FROM assets WHERE owner=? ORDER BY created_at DESC LIMIT 100').bind(c.get('user').email).all<{key:string;name:string;type:string;size:number}>();
  return c.json({assets:r.results.map(a=>({...a,url:`/api/media/${a.key}`}))});
});
app.post('/api/assets',async c=>{
  const length=Number(c.req.header('Content-Length')||0);
  if(length>21*1024*1024)return c.json({error:'Maximum upload size is 20 MB.'},413);
  const data=await c.req.formData(),file=data.get('file');
  if(!(file instanceof File))return c.json({error:'Choose a file.'},400);
  if(file.size>20*1024*1024)return c.json({error:'Maximum upload size is 20 MB.'},413);
  if(!['image/jpeg','image/png','image/webp','video/mp4','video/webm'].includes(file.type))return c.json({error:'Use JPG, PNG, WebP, MP4 or WebM.'},400);
  const owner=c.get('user').email,key=`uploads/${owner}/${crypto.randomUUID()}`,name=file.name.slice(0,200);
  await c.env.MEDIA.put(key,await file.arrayBuffer(),{httpMetadata:{contentType:file.type},customMetadata:{owner,name}});
  await c.env.DB.prepare('INSERT INTO assets(key,owner,name,type,size,created_at) VALUES(?,?,?,?,?,?)').bind(key,owner,name,file.type,file.size,now()).run();
  return c.json({key,name,type:file.type,size:file.size,url:`/api/media/${key}`},201);
});
app.get('/api/media/*',async c=>{
  const key=decodeURIComponent(c.req.path.slice('/api/media/'.length)),owner=c.get('user').email;
  if(!(key.startsWith(`generated/${owner}/`)||key.startsWith(`uploads/${owner}/`)))return c.json({error:'File not found.'},404);
  const object=await c.env.MEDIA.get(key,{range:c.req.raw.headers});
  if(!object)return c.json({error:'File not found.'},404);
  const headers=new Headers();object.writeHttpMetadata(headers);headers.set('ETag',object.httpEtag);headers.set('Accept-Ranges','bytes');headers.set('X-Content-Type-Options','nosniff');headers.set('Cache-Control','private, no-store');
  const range=object.range;
  if(range&&'offset' in range&&range.offset!==undefined){const len=range.length??object.size-range.offset;headers.set('Content-Range',`bytes ${range.offset}-${range.offset+len-1}/${object.size}`);headers.set('Content-Length',String(len));}
  else headers.set('Content-Length',String(object.size));
  return new Response(object.body,{status:headers.has('Content-Range')?206:200,headers});
});
app.onError((err,c)=>{
  if(err instanceof SyntaxError)return c.json({error:'Invalid JSON request.'},400);
  console.error('API request failed:',c.req.path,err.name);
  return c.json({error:'The service could not complete this request. Check Cloudflare bindings and try again.'},503);
});
app.notFound(c=>(c.req.path==='/api'||c.req.path.startsWith('/api/'))?c.json({error:'Endpoint not found.'},404):c.env.ASSETS.fetch(c.req.raw));
export default app;
