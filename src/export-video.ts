import type { Shot } from './storyboard';

type VideoJob = { shot_id: string; video_url?: string; status: string };
const WIDTH = 720;
const HEIGHT = 1280;

/** Reassemble local WASM chunks below Cloudflare Static Assets' per-file limit. */
export async function loadSelfHostedWasm(onProgress: (message: string) => void): Promise<string> {
  const manifestResponse = await fetch('/ffmpeg/manifest.json', { credentials: 'same-origin', redirect: 'error' });
  if (!manifestResponse.ok) throw new Error('The local video editor manifest could not be loaded.');
  const manifest: unknown = await manifestResponse.json();
  const data = manifest as { parts?: unknown; size?: unknown } | null;
  if (!data || !Array.isArray(data.parts) || data.parts.length < 1 || data.parts.length > 8
    || !data.parts.every(part => typeof part === 'string' && /^ffmpeg-core\.wasm\.part-\d+$/.test(part))
    || new Set(data.parts).size !== data.parts.length
    || typeof data.size !== 'number' || !Number.isSafeInteger(data.size) || data.size <= 0 || data.size > 8 * 16 * 1024 * 1024) {
    throw new Error('The local video editor manifest is invalid. Please rebuild the application.');
  }
  const chunks: ArrayBuffer[] = [];
  let size = 0;
  for (let index = 0; index < data.parts.length; index++) {
    onProgress(`Loading the local video editor (${index + 1}/${data.parts.length})…`);
    const response = await fetch(`/ffmpeg/${data.parts[index]}`, { credentials: 'same-origin', redirect: 'error' });
    if (!response.ok) throw new Error('A local video editor file could not be loaded. Please retry the export.');
    const chunk = await response.arrayBuffer();
    if (chunk.byteLength === 0 || chunk.byteLength > 16 * 1024 * 1024) throw new Error('A local video editor file has an invalid size.');
    size += chunk.byteLength;
    if (size > data.size) throw new Error('The local video editor files do not match their manifest.');
    chunks.push(chunk);
  }
  if (size !== data.size) throw new Error('The local video editor files do not match their manifest.');
  return URL.createObjectURL(new Blob(chunks, { type: 'application/wasm' }));
}

/** Rasterize in the browser so punctuation and emoji do not depend on FFmpeg fonts. */
async function subtitleImage(text: string): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser could not create the subtitle overlay.');
  context.font = '600 30px system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (line && context.measureText(next).width > WIDTH - 120) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
  }
  const lineHeight = 44;
  const boxHeight = lines.length * lineHeight + 30;
  const y = HEIGHT - 152 - boxHeight;
  context.fillStyle = 'rgba(12, 30, 24, 0.76)';
  context.beginPath();
  context.roundRect(38, y, WIDTH - 76, boxHeight, 18);
  context.fill();
  context.fillStyle = '#fffdf5';
  lines.forEach((line, index) => context.fillText(line, WIDTH / 2, y + 15 + lineHeight * (index + 0.5)));
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not render subtitles.')), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Browser-only assembly: trim to the storyboard edit, burn English subtitles,
 * preserve provider ASMR and softly mix the self-hosted original Christmas score.
 * Clips without provider audio receive silence before mixing. All runtime files
 * and the score are served from the same Cloudflare application origin.
 */
export async function assembleVideo(
  shots: Shot[],
  jobs: VideoJob[],
  onProgress: (message: string) => void,
): Promise<Blob> {
  if (!shots.length) throw new Error('Add at least one shot before exporting.');
  const ordered = [...shots].sort((a, b) => a.start - b.start);
  const sources = ordered.map(shot => {
    const job = jobs.find(candidate => candidate.shot_id === shot.id && ['succeeded', 'completed'].includes(candidate.status) && candidate.video_url);
    if (!job?.video_url) throw new Error(`Generate “${shot.title}” before assembling the film.`);
    if (!Number.isFinite(shot.end - shot.start) || shot.end <= shot.start) throw new Error(`“${shot.title}” has an invalid duration.`);
    const url = new URL(job.video_url, globalThis.location.href);
    if (url.origin !== globalThis.location.origin || !url.pathname.startsWith('/api/media/')) {
      throw new Error(`“${shot.title}” is not a stored workspace clip. Refresh its generation status and retry.`);
    }
    return { shot, url: url.href };
  });
  onProgress('Loading the local video editor…');
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const ffmpeg = new FFmpeg();
  let wasmURL: string | undefined;
  try {
    wasmURL = await loadSelfHostedWasm(onProgress);
    await ffmpeg.load({ coreURL: '/ffmpeg/ffmpeg-core.js', wasmURL });
    for (let index = 0; index < sources.length; index++) {
      const { shot, url } = sources[index];
      const source = `source-${index}.mp4`;
      const overlay = `subtitle-${index}.png`;
      const result = `part-${index}.mp4`;
      const probe = `probe-${index}.json`;
      onProgress(`Preparing shot ${index + 1} of ${sources.length}: ${shot.title}`);
      const response = await fetch(url, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`Could not download “${shot.title}” (${response.status}). Refresh its generation status and retry.`);
      await ffmpeg.writeFile(source, new Uint8Array(await response.arrayBuffer()));
      await ffmpeg.writeFile(overlay, await subtitleImage(shot.subtitle));
      const probeExit = await ffmpeg.ffprobe(['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=index', '-of', 'json', source, '-o', probe]);
      if (probeExit !== 0) throw new Error(`Could not inspect the audio in “${shot.title}”.`);
      const probeData = await ffmpeg.readFile(probe, 'utf8');
      const hasAudio = (JSON.parse(String(probeData)) as { streams?: unknown[] }).streams?.length;
      const duration = (shot.end - shot.start).toFixed(3);
      const inputs = ['-i', source, '-loop', '1', '-i', overlay];
      if (!hasAudio) inputs.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
      const exit = await ffmpeg.exec([
        ...inputs,
        '-filter_complex', `[0:v]setpts=PTS-STARTPTS,scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},setsar=1,fps=30[base];[base][1:v]overlay=0:0:shortest=1[v]`,
        '-map', '[v]', '-map', hasAudio ? '0:a:0' : '2:a:0',
        '-t', duration, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '22',
        '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '128k',
        '-af', 'aresample=async=1:first_pts=0,apad', '-video_track_timescale', '90000', '-movflags', '+faststart', '-y', result,
      ]);
      if (exit !== 0) throw new Error(`Could not render “${shot.title}”. Try a desktop browser with more available memory.`);
      await Promise.all([ffmpeg.deleteFile(source), ffmpeg.deleteFile(overlay), ffmpeg.deleteFile(probe)]);
    }
    onProgress('Joining your Christmas film…');
    const playlist = sources.map((_, index) => `file 'part-${index}.mp4'`).join('\n');
    await ffmpeg.writeFile('playlist.txt', new TextEncoder().encode(playlist));
    const totalDuration = sources.reduce((total, item) => total + item.shot.end - item.shot.start, 0);
    const joined = await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', 'playlist.txt', '-t', totalDuration.toFixed(3), '-c', 'copy', '-movflags', '+faststart', '-y', 'joined.mp4']);
    if (joined !== 0) throw new Error('The final assembly failed. Your generated clips are still available individually.');
    for (let index = 0; index < sources.length; index++) await ffmpeg.deleteFile(`part-${index}.mp4`);
    onProgress('Adding a little Christmas music…');
    const music = await fetch('/audio/christmas-bells.wav', { credentials: 'same-origin' });
    if (!music.ok) throw new Error('The Christmas soundtrack could not be loaded. Please retry the export.');
    await ffmpeg.writeFile('christmas-bells.wav', new Uint8Array(await music.arrayBuffer()));
    const fadeIn = Math.min(0.8, totalDuration / 2).toFixed(3);
    const fadeOut = Math.min(2, totalDuration / 2).toFixed(3);
    const fadeStart = Math.max(0, totalDuration - Number(fadeOut)).toFixed(3);
    const mixed = await ffmpeg.exec([
      '-i', 'joined.mp4', '-stream_loop', '-1', '-i', 'christmas-bells.wav',
      '-filter_complex', `[0:a]aresample=async=1:first_pts=0,volume=1[asmr];[1:a]volume=0.22,afade=t=in:d=${fadeIn},afade=t=out:st=${fadeStart}:d=${fadeOut}[music];[asmr][music]amix=inputs=2:duration=first:normalize=0[aout]`,
      '-map', '0:v:0', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k',
      '-ar', '48000', '-ac', '2', '-t', totalDuration.toFixed(3), '-movflags', '+faststart', '-y', 'christmas-kitten.mp4',
    ]);
    if (mixed !== 0) throw new Error('The soundtrack mix failed. Your generated clips are still available individually.');
    const output = await ffmpeg.readFile('christmas-kitten.mp4');
    if (typeof output === 'string') throw new Error('The video editor returned an invalid output.');
    const copy = new Uint8Array(output.byteLength);
    copy.set(output);
    onProgress('Your film is ready.');
    return new Blob([copy.buffer], { type: 'video/mp4' });
  } finally {
    ffmpeg.terminate();
    if (wasmURL) URL.revokeObjectURL(wasmURL);
  }
}
