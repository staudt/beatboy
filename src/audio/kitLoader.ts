import type { SoundId } from '../domain/types';
import { sliceRegions } from './onset';
import type { KitManifest } from './types';

export interface LoadedKit {
  manifest: KitManifest;
  buffers: Partial<Record<SoundId, AudioBuffer>>;
}

async function fetchOk(url: string, what: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error(`Failed to fetch ${what} (${url}): ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) throw new Error(`Failed to load ${what} (${url}): HTTP ${res.status} ${res.statusText}`);
  return res;
}

export async function loadKit(ctx: BaseAudioContext, manifestUrl: string): Promise<LoadedKit> {
  const base = typeof location !== 'undefined' ? location.href : undefined;
  const absManifest = new URL(manifestUrl, base).href;
  const manifest = (await (await fetchOk(absManifest, 'kit manifest')).json()) as KitManifest;
  const spriteUrl = new URL(manifest.file, absManifest).href;
  const bytes = await (await fetchOk(spriteUrl, 'kit sprite')).arrayBuffer();
  let sprite: AudioBuffer;
  try {
    sprite = await ctx.decodeAudioData(bytes);
  } catch (e) {
    throw new Error(`Failed to decode kit sprite (${spriteUrl}): ${e instanceof Error ? e.message : String(e)}`);
  }
  const regions = sliceRegions(sprite.getChannelData(0), sprite.sampleRate, manifest.sounds);
  const buffers: Partial<Record<SoundId, AudioBuffer>> = {};
  for (const [id, r] of Object.entries(regions) as [SoundId, { startSample: number; length: number }][]) {
    if (r.length <= 0) continue;
    const buf = ctx.createBuffer(sprite.numberOfChannels, r.length, sprite.sampleRate);
    for (let c = 0; c < sprite.numberOfChannels; c++) {
      buf.copyToChannel(sprite.getChannelData(c).subarray(r.startSample, r.startSample + r.length), c);
    }
    buffers[id] = buf;
  }
  return { manifest, buffers };
}
