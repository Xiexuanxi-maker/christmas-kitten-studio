import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSelfHostedWasm } from '../src/export-video';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const response = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

describe('self-hosted video editor runtime', () => {
  it('joins all manifest chunks in order without an external CDN', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ parts: ['ffmpeg-core.wasm.part-0', 'ffmpeg-core.wasm.part-1'], size: 5 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([0, 97, 115])))
      .mockResolvedValueOnce(new Response(new Uint8Array([109, 1])));
    vi.stubGlobal('fetch', fetcher);
    const createURL = vi.spyOn(URL, 'createObjectURL');
    const url = await loadSelfHostedWasm(vi.fn());
    try {
      expect(url).toMatch(/^blob:/);
      const blob = createURL.mock.calls[0][0] as Blob;
      expect(blob.type).toBe('application/wasm');
      expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual([0, 97, 115, 109, 1]);
      expect(fetcher.mock.calls.map(call => call[0])).toEqual([
        '/ffmpeg/manifest.json', '/ffmpeg/ffmpeg-core.wasm.part-0', '/ffmpeg/ffmpeg-core.wasm.part-1',
      ]);
      expect(fetcher.mock.calls.every(call => call[1].redirect === 'error')).toBe(true);
    } finally { URL.revokeObjectURL(url); }
  });

  it.each([
    { parts: [], size: 1 },
    { parts: Array.from({ length: 9 }, (_, i) => `ffmpeg-core.wasm.part-${i}`), size: 9 },
    { parts: ['https://outside.example/ffmpeg-core.wasm.part-0'], size: 1 },
    { parts: ['../ffmpeg-core.wasm.part-0'], size: 1 },
    { parts: ['ffmpeg-core.wasm.part-0', 'ffmpeg-core.wasm.part-0'], size: 2 },
    { parts: ['ffmpeg-core.wasm.part-0'], size: -1 },
    { parts: ['ffmpeg-core.wasm.part-0'], size: 1.5 },
  ])('rejects malformed manifests before fetching chunks', async manifest => {
    const fetcher = vi.fn().mockResolvedValue(response(manifest));
    vi.stubGlobal('fetch', fetcher);
    await expect(loadSelfHostedWasm(vi.fn())).rejects.toThrow('manifest is invalid');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects truncated runtime chunks', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response({ parts: ['ffmpeg-core.wasm.part-0'], size: 3 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([0, 97]))));
    await expect(loadSelfHostedWasm(vi.fn())).rejects.toThrow('do not match their manifest');
  });
});
