import { mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
const target='public/ffmpeg';
await mkdir(target, {recursive:true});
await copyFile('node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js',`${target}/ffmpeg-core.js`);
// Workers Static Assets allows 25 MiB per file. The 31 MiB WASM must be split.
await rm(`${target}/ffmpeg-core.wasm`,{force:true});
const wasm=await readFile('node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm');
const chunkSize=16*1024*1024,parts=[];
for(let start=0;start<wasm.length;start+=chunkSize){
  const name=`ffmpeg-core.wasm.part-${parts.length}`;
  await writeFile(`${target}/${name}`,wasm.subarray(start,Math.min(wasm.length,start+chunkSize)));
  parts.push(name);
}
await writeFile(`${target}/manifest.json`,JSON.stringify({parts,size:wasm.length}));
