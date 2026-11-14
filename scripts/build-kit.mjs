#!/usr/bin/env node
// One-time kit builder: downloads a handful of CC0 samples (pinned to commit SHAs),
// processes them with ffmpeg and writes one mono MP3 "sprite" + kit.json offset map.
// Usage: node scripts/build-kit.mjs      (needs /usr/bin/ffmpeg + ffprobe on PATH, Node 18+)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.kit-cache');
const OUT_DIR = path.join(ROOT, 'public/kits/virtuosity');
const SR = 44100;
const LEAD_IN = 0.08; // seconds of digital silence before every sound
const PEAK_DB = -1;
const MP3_KBPS = 112;
const FFMPEG = '/usr/bin/ffmpeg';

const REPOS = {
  vd: { owner: 'sfzinstruments', repo: 'virtuosity_drums', branch: 'master' },
  ph: { owner: 'august-byrne', repo: 'phazite-sounds', branch: 'main' },
};

// ---- Sound table -----------------------------------------------------------------------
// src: [repo, path, weight]; len: seconds kept; fade: fraction of len used for the exp fade;
// pitch: semitones (resampling); gain: runtime balance gain written to kit.json
// (tuned against each sound's first-100 ms RMS so kick/snare sit level, toms just under, cymbals/hats behind).
const vd = (mic, group, name) => ['vd', `Samples/${mic}/${group}/${mic}_${group}_${name}.flac`];
const PERC = (inst, file) => ['vd', `Samples/perc/oh/${inst}/${file}`];
const SOUNDS = [
  { id: 'kick', len: 0.75, gain: 0.85,
    src: [[...vd('kickmic', 'kick', 'snoff_vl3_rr1'), 0.7], [...vd('oh', 'kick', 'snoff_vl3_rr1'), 0.3]] },
  { id: 'snare', len: 0.75, gain: 1.0,
    src: [[...vd('snaremic', 'snare', 'center_vl27'), 0.6], [...vd('oh', 'snare', 'center_vl27'), 0.4]] },
  { id: 'sidestick', len: 0.6, gain: 0.7,
    src: [[...vd('snaremic', 'snare', 'crossstick_vl12'), 0.5], [...vd('oh', 'snare', 'crossstick_vl12'), 0.5]] },
  { id: 'clap', len: 0.6, gain: 0.75, src: [['ph', 'pack/Drums/Claps/Clap Studio.flac', 1]] },
  { id: 'hatClosed', len: 0.4, gain: 0.6, src: [[...vd('oh', 'hh', 'closed_vl3_rr1'), 1]] },
  { id: 'hatPedal', len: 0.4, gain: 0.3, src: [[...vd('oh', 'hh', 'pedal_vl2_rr1'), 1]] },
  { id: 'hatOpen', len: 1.0, gain: 0.5, src: [[...vd('oh', 'hh', 'open_vl3_rr1'), 1]] },
  { id: 'ride', len: 1.8, gain: 0.6, src: [[...vd('oh', 'ride', 'ride_vl2_rr1'), 1]] },
  { id: 'rideBell', len: 1.8, gain: 0.5, src: [[...vd('oh', 'ride', 'bell_vl2_rr1'), 1]] },
  { id: 'crash', len: 2.2, gain: 0.55, src: [[...vd('oh', 'crash', 'crash_vl2_rr1'), 1]] },
  { id: 'crash2', len: 2.2, gain: 0.55, src: [[...vd('oh', 'flatride', 'crash_vl3'), 1]] },
  { id: 'tomHigh', len: 1.1, gain: 0.6,
    src: [[...vd('oh', 'htom', 'center_vl12'), 0.7], [...vd('mid', 'htom', 'center_vl12'), 0.3]] },
  // No mid tom in the library: high tom pitched down 3 semitones.
  { id: 'tomMid', len: 1.2, gain: 0.6, pitch: -3,
    src: [[...vd('oh', 'htom', 'center_vl12'), 0.7], [...vd('mid', 'htom', 'center_vl12'), 0.3]] },
  // No floor tom in the library: low tom (ltom) center.
  { id: 'tomFloor', len: 1.2, gain: 0.55,
    src: [[...vd('oh', 'ltom', 'center_vl12'), 0.7], [...vd('mid', 'ltom', 'center_vl12'), 0.3]] },
  { id: 'tambourine', len: 0.6, gain: 0.4, src: [[...PERC('tambourine', 'Tamb1_Shake_rr1_Overhead.wav'), 1]] },
  { id: 'cowbell', len: 0.6, gain: 0.4, src: [[...PERC('cowbell', 'Cowbell1_Normal_v2_rr1_Overhead.wav'), 1]] },
];

// ---- helpers ---------------------------------------------------------------------------
const log = (...a) => console.log(...a);
const mkdir = (d) => fs.mkdirSync(d, { recursive: true });
const ff = (args) => execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });

async function ghJson(url) {
  const headers = { 'User-Agent': 'kit-builder', Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

async function resolveRepo(key) {
  const { owner, repo, branch } = REPOS[key];
  const f = path.join(CACHE, `${key}-resolved.json`);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const sha = (await ghJson(`https://api.github.com/repos/${owner}/${repo}/commits/${branch}`)).sha;
  const tree = await ghJson(`https://api.github.com/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`);
  const out = { sha, files: tree.tree.filter((t) => t.type === 'blob').map((t) => t.path) };
  fs.writeFileSync(f, JSON.stringify(out));
  return out;
}

const rawUrl = (key, sha, p) =>
  `https://raw.githubusercontent.com/${REPOS[key].owner}/${REPOS[key].repo}/${sha}/${p.split('/').map(encodeURIComponent).join('/')}`;
const blobUrl = (key, sha, p) =>
  `https://github.com/${REPOS[key].owner}/${REPOS[key].repo}/blob/${sha}/${p.split('/').map(encodeURIComponent).join('/')}`;

async function download(url, dest) {
  if (fs.existsSync(dest)) return;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  mkdir(path.dirname(dest));
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
}

/** Read a PCM WAV: returns {channels, sampleRate, bits, data(Buffer)}; exact sample counts. */
function readWav(file) {
  const b = fs.readFileSync(file);
  let pos = 12, fmt = null;
  while (pos + 8 <= b.length) {
    const id = b.toString('ascii', pos, pos + 4);
    let size = b.readUInt32LE(pos + 4);
    if (id === 'fmt ') fmt = { channels: b.readUInt16LE(pos + 10), sampleRate: b.readUInt32LE(pos + 12), bits: b.readUInt16LE(pos + 22) };
    if (id === 'data') {
      size = Math.min(size, b.length - pos - 8);
      return { ...fmt, data: b.subarray(pos + 8, pos + 8 + size) };
    }
    pos += 8 + size + (size & 1);
  }
  throw new Error(`no data chunk in ${file}`);
}

function writeWav(file, pcm16Mono) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm16Mono.length, 4); h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm16Mono.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, pcm16Mono]));
}

function peakDb(file) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /max_volume:\s*(-?[\d.]+) dB/.exec(r.stderr);
  if (!m) throw new Error('volumedetect failed for ' + file);
  return parseFloat(m[1]);
}

// ---- main ------------------------------------------------------------------------------
async function main() {
  mkdir(CACHE); mkdir(path.join(CACHE, 'processed')); mkdir(OUT_DIR);
  mkdir(path.join(ROOT, 'public/kits'));
  const resolved = { vd: await resolveRepo('vd'), ph: await resolveRepo('ph') };
  log(`virtuosity_drums @ ${resolved.vd.sha}\nphazite-sounds   @ ${resolved.ph.sha}`);

  // Download
  const srcPath = (key, p) => path.join(CACHE, 'src', key, p);
  for (const s of SOUNDS) for (const [key, p] of s.src) {
    if (!resolved[key].files.includes(p)) throw new Error(`${s.id}: ${p} not found in ${key} tree`);
    await download(rawUrl(key, resolved[key].sha, p), srcPath(key, p));
  }
  const phSources = path.join(CACHE, 'src/ph/pack/sources.json');
  await download(rawUrl('ph', resolved.ph.sha, 'pack/sources.json'), phSources);
  const clapProv = JSON.parse(fs.readFileSync(phSources, 'utf8')).sounds.find((x) => x.file === 'Drums/Claps/Clap Studio.flac');
  fs.writeFileSync(path.join(CACHE, 'clap-provenance.json'), JSON.stringify(clapProv, null, 2));

  // Process each sound -> 44.1k mono 16-bit WAV, peak -1 dBFS
  const processed = [];
  for (const s of SOUNDS) {
    const inputs = s.src.flatMap(([key, p]) => ['-i', srcPath(key, p)]);
    const n = s.src.length;
    // aformat=mono uses ffmpeg's standard stereo->mono downmix (also fine for mono sources).
    const chains = s.src.map(([, , w], i) => `[${i}:a]aformat=channel_layouts=mono,aresample=${SR},volume=${w}[a${i}]`);
    const mix = n > 1 ? `${s.src.map((_, i) => `[a${i}]`).join('')}amix=inputs=${n}:normalize=0:duration=longest[m]` : '[a0]anull[m]';
    const pitch = s.pitch ? `,asetrate=${Math.round(SR * 2 ** (s.pitch / 12))},aresample=${SR}` : '';
    const fadeLen = s.len * 0.35;
    const post = `[m]${pitch.replace(/^,/, '') || 'anull'},silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.001,` +
      `atrim=end=${s.len},afade=t=out:st=${(s.len - fadeLen).toFixed(4)}:d=${fadeLen.toFixed(4)}:curve=qsin[o]`;
    const tmp = path.join(CACHE, 'processed', `${s.id}.tmp.wav`);
    ff([...inputs, '-filter_complex', [...chains, mix, post].join(';'), '-map', '[o]', '-ar', String(SR), '-ac', '1', '-c:a', 'pcm_f32le', tmp]);
    const gain = PEAK_DB - peakDb(tmp);
    const out = path.join(CACHE, 'processed', `${s.id}.wav`);
    ff(['-i', tmp, '-af', `volume=${gain.toFixed(3)}dB,aresample=${SR}`, '-ac', '1', '-c:a', 'pcm_s16le', out]);
    fs.rmSync(tmp);
    const w = readWav(out);
    if (w.sampleRate !== SR || w.channels !== 1 || w.bits !== 16) throw new Error(`${s.id}: bad format`);
    processed.push({ s, pcm: w.data, samples: w.data.length / 2 });
    log(`${s.id.padEnd(11)} ${(w.data.length / 2 / SR).toFixed(4)} s  peak ${peakDb(out)} dB  (norm gain ${gain.toFixed(2)} dB)`);
  }

  // Concatenate with lead-in silence, exact sample offsets
  const lead = Math.round(LEAD_IN * SR);
  const parts = []; const sounds = {}; let pos = 0;
  for (const { s, pcm, samples } of processed) {
    parts.push(Buffer.alloc(lead * 2)); pos += lead;
    sounds[s.id] = { start: +(pos / SR).toFixed(4), duration: +(samples / SR).toFixed(4), gain: s.gain };
    parts.push(pcm); pos += samples;
  }
  const all = path.join(CACHE, 'kit.wav');
  writeWav(all, Buffer.concat(parts));
  ff(['-i', all, '-c:a', 'libmp3lame', '-b:a', `${MP3_KBPS}k`, '-ac', '1', '-ar', String(SR), path.join(OUT_DIR, 'kit.mp3')]);

  const kit = {
    id: 'virtuosity', name: 'Virtuosity Studio', version: 1, file: 'kit.mp3', sampleRate: SR, sounds,
    credits: [
      { name: 'Virtuosity Drums', author: 'Versilian Studios', license: 'CC0-1.0', url: 'https://github.com/sfzinstruments/virtuosity_drums', commit: resolved.vd.sha },
      { name: 'Phazite Sounds', author: 'august-byrne', license: 'CC0-1.0', url: 'https://github.com/august-byrne/phazite-sounds', commit: resolved.ph.sha, note: 'clap only' },
    ],
  };
  fs.writeFileSync(path.join(OUT_DIR, 'kit.json'), JSON.stringify(kit, null, 2) + '\n');
  fs.writeFileSync(path.join(ROOT, 'public/kits/index.json'),
    JSON.stringify({ kits: [{ id: 'virtuosity', name: 'Virtuosity Studio', path: 'kits/virtuosity/kit.json' }] }, null, 2) + '\n');

  writeLicenses(resolved, clapProv);
  log(`\nkit.mp3: ${fs.statSync(path.join(OUT_DIR, 'kit.mp3')).size} bytes, ${(pos / SR).toFixed(4)} s`);
}

function writeLicenses(resolved, clapProv) {
  const L = [];
  L.push('# Asset licenses', '',
    'All bundled audio is released under **CC0-1.0** (public domain dedication). No attribution is required; credit is given here anyway.', '',
    '- Virtuosity Drums by Versilian Studios: https://github.com/sfzinstruments/virtuosity_drums (commit `' + resolved.vd.sha + '`)',
    '- Phazite Sounds by august-byrne: https://github.com/august-byrne/phazite-sounds (commit `' + resolved.ph.sha + '`), used only for the clap.', '',
    'The kit (`public/kits/virtuosity/kit.mp3` + `kit.json`) is rebuilt with `node scripts/build-kit.mjs` (needs ffmpeg; downloads are cached in `.kit-cache/`).', '',
    '## Processing (all sounds)', '',
    '1. Stereo mixed down to mono; when two mics are listed they are summed with the weights shown (same take, time-aligned).',
    '2. Leading silence trimmed (threshold -50 dB, 1 ms kept before the transient).',
    `3. Truncated to the length shown, with a quarter-sine exponential-style fade (\`qsin\`) over the last 35% of that length.`,
    `4. Peak-normalized to ${PEAK_DB} dBFS, 44.1 kHz mono 16-bit.`,
    `5. Concatenated with 0.08 s of silence before each sound and encoded as a single mono MP3 (libmp3lame, ${MP3_KBPS} kbps CBR).`, '',
    '## Sounds', '');
  for (const s of SOUNDS) {
    const files = s.src.map(([key, p, w]) => `[\`${p}\`](${blobUrl(key, resolved[key].sha, p)})${s.src.length > 1 ? ` x${w}` : ''}`).join(' + ');
    L.push(`- **${s.id}**: ${files}; length ${s.len} s${s.pitch ? `; pitched ${s.pitch} semitones by resampling` : ''}.`);
  }
  L.push('', '### Notes', '',
    '- `tomMid` is the high-tom sample pitched down 3 semitones (the library has no mid tom); `tomFloor` uses the low tom (`ltom`) center, since the library has no floor tom.',
    '- `crash2` is the flat-ride crash articulation.', '');
  if (clapProv) {
    L.push('### Clap provenance (from Phazite Sounds `pack/sources.json`)', '');
    for (const src of clapProv.sources) L.push(`- ${src.title} by ${src.author}, ${src.licence}: ${src.url}`);
    L.push(`- Upstream processing in Phazite: ${clapProv.processing}`, '');
  }
  fs.writeFileSync(path.join(ROOT, 'ASSET_LICENSES.md'), L.join('\n'));
}

main().catch((e) => { console.error(e); process.exit(1); });
