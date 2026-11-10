import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTask, getTask, SEEDANCE_API_BASE, SEEDANCE_STATUSES } from '../worker/seedance';

const key = 'test-key-never-expose';
const model = 'doubao-seedance-2-0-260128';
const prompt = 'A premium acrylic Christmas kitten calendar in warm cinematic light.';
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());

describe('Seedance task creation', () => {
  it.each([[2.4, 4], [5.2, 6], [40, 15]])('clamps %s seconds to valid source duration %s', async (duration, expectedDuration) => {
    const fetcher = vi.fn().mockResolvedValue(response({ id: 'cgt-20261110-test' }));
    vi.stubGlobal('fetch', fetcher);
    await expect(createTask(key, model, prompt, duration)).resolves.toEqual({ id: 'cgt-20261110-test', status: 'queued' });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(SEEDANCE_API_BASE);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Bearer ${key}`);
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body)).toEqual({
      model, content: [{ type: 'text', text: prompt }], duration: expectedDuration,
      ratio: '9:16', resolution: '720p', generate_audio: true, watermark: false,
    });
  });

  it('validates configuration and user input before spending a provider request', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(createTask('', model, prompt, 4)).rejects.toThrow('API key');
    await expect(createTask(key, '../model', prompt, 4)).rejects.toThrow('model ID');
    await expect(createTask(key, model, 'tiny', 4)).rejects.toThrow('10 and 6000');
    await expect(createTask(key, model, prompt, NaN)).rejects.toThrow('positive number');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('never exposes upstream error bodies or credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ error: { message: `Rejected Authorization: Bearer ${key}. ${prompt}` } }, 401)));
    const error = await createTask(key, model, prompt, 4).catch((value: Error) => value);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('access was denied');
    expect((error as Error).message).not.toContain(key);
    expect((error as Error).message).not.toContain(prompt);
  });

  it('sanitizes network and timeout failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(`Timeout: ${key}`)));
    await expect(createTask(key, model, prompt, 4)).rejects.toThrow('could not be reached');
  });
});

describe('Seedance task queries', () => {
  it.each(SEEDANCE_STATUSES)('supports documented state %s', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      id: 'cgt-test', status,
      content: { video_url: 'https://ark-content-generation-cn-beijing.tos-cn-beijing.volces.com/video.mp4' },
      error: { code: 'GenerationFailed', message: `Sensitive upstream context ${key}` },
    })));
    const task = await getTask(key, 'cgt-test');
    expect(task.status).toBe(status);
    expect(JSON.stringify(task)).not.toContain(key);
    if (status === 'succeeded') expect(task.content?.video_url).toMatch(/^https:/);
    else expect(task.content).toBeUndefined();
    if (['failed', 'expired', 'cancelled'].includes(status)) expect(task.error?.message).toBeTruthy();
  });

  it.each([
    { id: 'cgt-other', status: 'running' },
    { id: 'cgt-test', status: 'unknown' },
    { id: 'cgt-test', status: 'succeeded', content: { video_url: 'http://insecure.example/video.mp4' } },
    { id: 'cgt-test', status: 'succeeded' },
  ])('rejects malformed task response', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(body)));
    await expect(getTask(key, 'cgt-test')).rejects.toThrow();
  });

  it('rejects path injection in task IDs without a request', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(getTask(key, '../secrets')).rejects.toThrow('valid Seedance task ID');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
