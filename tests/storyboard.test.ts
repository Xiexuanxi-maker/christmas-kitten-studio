import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialShots } from '../src/storyboard';
import { assembleVideo } from '../src/export-video';

afterEach(() => vi.unstubAllGlobals());

describe('Christmas Kitten V2 editing contract', () => {
  it('covers exactly 40 continuous seconds without missing or overlapping shots', () => {
    expect(initialShots).toHaveLength(12);
    expect(new Set(initialShots.map(shot => shot.id)).size).toBe(initialShots.length);
    expect(initialShots[0].start).toBe(0);
    expect(initialShots.at(-1)?.end).toBe(40);
    initialShots.forEach((shot, index) => {
      expect(shot.end).toBeGreaterThan(shot.start);
      if (index) expect(shot.start).toBe(initialShots[index - 1].end);
    });
    expect(initialShots.reduce((duration, shot) => duration + shot.end - shot.start, 0)).toBe(40);
  });

  it('reserves 12–20 seconds for the replacement packaging sequence', () => {
    const packaging = initialShots.filter(shot => shot.start >= 12 && shot.end <= 20);
    expect(packaging.map(shot => shot.subtitle)).toEqual([
      'Acrylic Advent Calendar Gift Set',
      'Premium acrylic • polished edges',
      'Perfect for gifting & collecting ✨',
    ]);
    expect(packaging[0].start).toBe(12);
    expect(packaging.at(-1)?.end).toBe(20);
    expect(packaging.map(shot => shot.prompt).join(' ')).toContain('gold hinges');
  });

  it('includes only the five selected kitten details in the 20–32 second sequence', () => {
    const kittens = initialShots.filter(shot => shot.start >= 20 && shot.end <= 32);
    expect(kittens.map(shot => shot.kitten)).toEqual([
      'Blue-eyed Ragdoll', 'Reindeer Orange Tabby', 'Golden-eyed Black Cat', 'Christmas Elf Cat', 'Bookish Glasses Cat',
    ]);
    expect(kittens.map(shot => shot.subtitle)).toEqual([
      'Blue-eyed baby 🥹', 'Little reindeer!', 'Tiny Christmas magic ✨', 'Santa’s helper!', 'Too cute to handle!',
    ]);
  });

  it('preserves the opening, unboxing, first reveal and interactive closing captions', () => {
    expect(initialShots.slice(0, 3).map(shot => shot.subtitle)).toEqual([
      'The cutest Christmas countdown gift 🎄', '24 days. 24 tiny surprises.', 'Look at those tiny details…',
    ]);
    expect(initialShots.at(-1)?.subtitle).toBe('24 Days of Purrfect Surprises 🎁\nWhich kitten is your favorite?');
  });
});

describe('video export preflight', () => {
  it('requires real completed clips before starting the video runtime', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(assembleVideo(initialShots, [], vi.fn())).rejects.toThrow('before assembling');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects external clip URLs before any network request', async () => {
    vi.stubGlobal('location', new URL('https://studio.example/'));
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(assembleVideo([initialShots[0]], [{
      shot_id: initialShots[0].id, status: 'succeeded', video_url: 'https://outside.example/video.mp4',
    }], vi.fn())).rejects.toThrow('not a stored workspace clip');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects invalid scene timing without loading the runtime or fetching media', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const shot = { ...initialShots[0], end: -1 };
    await expect(assembleVideo([shot], [{
      shot_id: shot.id, status: 'succeeded', video_url: '/api/media/example.mp4',
    }], vi.fn())).rejects.toThrow('invalid duration');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
