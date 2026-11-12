/** Volcano Ark's official asynchronous Seedance API. Never import this in client code. */
export const SEEDANCE_API_BASE = 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks';
export const SEEDANCE_STATUSES = ['queued', 'running', 'cancelled', 'succeeded', 'failed', 'expired'] as const;
export type SeedanceStatus = typeof SEEDANCE_STATUSES[number];
export type SeedanceTask = {
  id: string;
  status: SeedanceStatus;
  content?: { video_url?: string };
  error?: { message?: string; code?: string };
};

export class SeedanceError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'SeedanceError';
  }
}

type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function credentials(apiKey: string) {
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!/^[\x21-\x7E]+$/.test(key)) {
    throw new SeedanceError('Seedance API key is not configured. Add ARK_API_KEY as a Worker secret.');
  }
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(value);
}

async function request(url: string, init: RequestInit): Promise<JsonObject> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(25_000), redirect: 'error' });
  } catch {
    throw new SeedanceError('Seedance could not be reached. Please try again shortly.');
  }
  // Do not expose upstream response text: it can contain credentials, prompts or signed URLs.
  if (!response.ok) {
    const message = response.status === 401 || response.status === 403
      ? 'Seedance access was denied. Check the server-side API key and model activation.'
      : response.status === 429
        ? 'Seedance is at its rate or concurrency limit. Please try again shortly.'
        : response.status === 404
          ? 'Seedance task or model was not found. Task IDs expire after seven days.'
          : response.status === 400 || response.status === 422
            ? 'Seedance rejected the request. Check the model configuration and prompt.'
            : 'Seedance is temporarily unavailable. Please try again shortly.';
    throw new SeedanceError(message, response.status);
  }
  try {
    const data: unknown = await response.json();
    if (!isObject(data)) throw new Error('Invalid response');
    return data;
  } catch {
    throw new SeedanceError('Seedance returned an invalid response. Please try again shortly.');
  }
}

/** Durations use source-clip seconds, not final timeline duration; shorter shots are trimmed later. */
export async function createTask(apiKey: string, model: string, prompt: string, duration: number): Promise<SeedanceTask> {
  const headers = credentials(apiKey);
  if (typeof model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(model)) {
    throw new SeedanceError('A valid Seedance model ID is required.');
  }
  if (typeof prompt !== 'string' || prompt.trim().length < 10 || prompt.length > 6000) {
    throw new SeedanceError('The video prompt must contain between 10 and 6000 characters.');
  }
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new SeedanceError('The source clip duration must be a positive number.');
  }
  const data = await request(SEEDANCE_API_BASE, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      content: [{ type: 'text', text: prompt.trim() }],
      duration: Math.min(15, Math.max(4, Math.ceil(duration))),
      ratio: '9:16',
      resolution: '720p',
      generate_audio: true,
      watermark: false,
    }),
  });
  if (!validId(data.id)) throw new SeedanceError('Seedance did not return a valid task ID.');
  return { id: data.id, status: 'queued' };
}

export async function getTask(apiKey: string, id: string): Promise<SeedanceTask> {
  const headers = credentials(apiKey);
  if (!validId(id)) throw new SeedanceError('A valid Seedance task ID is required.');
  const data = await request(`${SEEDANCE_API_BASE}/${encodeURIComponent(id)}`, { method: 'GET', headers });
  if (data.id !== id || !SEEDANCE_STATUSES.includes(data.status as SeedanceStatus)) {
    throw new SeedanceError('Seedance returned an invalid task state.');
  }
  const task: SeedanceTask = { id, status: data.status as SeedanceStatus };
  if (task.status === 'succeeded') {
    const videoUrl = isObject(data.content) ? data.content.video_url : undefined;
    try {
      if (typeof videoUrl !== 'string') throw new Error('Missing video');
      const url = new URL(videoUrl);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid video URL');
      task.content = { video_url: videoUrl };
    } catch {
      throw new SeedanceError('Seedance completed without a valid video download URL.');
    }
  }
  if (task.status === 'failed' || task.status === 'expired' || task.status === 'cancelled') {
    const upstreamCode = isObject(data.error) ? data.error.code : undefined;
    task.error = {
      ...(typeof upstreamCode === 'string' && !upstreamCode.includes(apiKey.trim()) && /^[A-Za-z][A-Za-z0-9_.-]{0,99}$/.test(upstreamCode) ? { code: upstreamCode } : {}),
      message: task.status === 'expired'
        ? 'The Seedance task exceeded its execution time limit.'
        : task.status === 'cancelled'
          ? 'The Seedance task was cancelled.'
          : 'Seedance could not generate this clip. Review the prompt and account model access, then retry.',
    };
  }
  return task;
}
