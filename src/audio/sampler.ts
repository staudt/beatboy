import { VELOCITY } from '../domain/types';
import type { SoundId } from '../domain/types';
import type { NoteSink } from '../engine/types';
import type { LoadedKit } from './kitLoader';
import { velocityToGain } from './velocity';
import { planVoiceCuts, type ActiveVoice } from './voiceCuts';

export { planVoiceCuts } from './voiceCuts';
export type { ActiveVoice } from './voiceCuts';

const POLYPHONY_CAP = 8;

interface Voice extends ActiveVoice {
  src: AudioBufferSourceNode;
  gain: GainNode;
}

export class Sampler implements NoteSink {
  private kit: LoadedKit | null = null;
  private readonly master: GainNode;
  private readonly limiter: DynamicsCompressorNode;
  private voices: Voice[] = [];
  private nextId = 1;

  constructor(
    private readonly ctx: AudioContext,
    destination: AudioNode = ctx.destination,
  ) {
    this.master = ctx.createGain();
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.ratio.value = 12;
    this.limiter.knee.value = 6;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.15;
    this.master.connect(this.limiter);
    this.limiter.connect(destination);
  }

  setKit(kit: LoadedKit): void {
    this.kit = kit;
  }

  get hasKit(): boolean {
    return this.kit !== null;
  }

  play(time: number, sound: SoundId, vel: number, trackGain: number): void {
    const kit = this.kit;
    const buffer = kit?.buffers[sound];
    if (!kit || !buffer) return;

    const cuts = planVoiceCuts(this.voices, sound, time, POLYPHONY_CAP);
    if (cuts.length) {
      for (const v of this.voices) {
        if (!cuts.includes(v.id)) continue;
        try {
          v.gain.gain.setTargetAtTime(0, time, 0.008);
          v.src.stop(time + 0.06);
        } catch {
          /* already stopped */
        }
        v.endTime = time + 0.06;
      }
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const g = this.ctx.createGain();
    g.gain.value = velocityToGain(vel) * (kit.manifest.sounds[sound]?.gain ?? 1) * trackGain;
    src.connect(g);
    g.connect(this.master);
    const voice: Voice = { id: this.nextId++, sound, startTime: time, endTime: time + buffer.duration, src, gain: g };
    this.voices.push(voice);
    src.addEventListener('ended', () => {
      this.voices = this.voices.filter((v) => v !== voice);
      try {
        g.disconnect();
      } catch {
        /* ignore */
      }
    });
    src.start(time);
  }

  audition(sound: SoundId, vel: number = VELOCITY.normal): void {
    this.play(this.ctx.currentTime, sound, vel, 1);
  }

  stopAll(): void {
    const now = this.ctx.currentTime;
    const m = this.master.gain;
    m.cancelScheduledValues(now);
    m.setValueAtTime(m.value, now);
    m.linearRampToValueAtTime(0, now + 0.03);
    for (const v of this.voices) {
      try {
        v.src.stop(now + 0.035);
      } catch {
        /* may throw if never started / already stopped */
      }
    }
    this.voices = [];
    m.setValueAtTime(1, now + 0.04);
  }
}
