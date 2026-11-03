// 場面ごとの連続再生トラックを作る（ポルトガル語 → 間 → 日本語 → ポルトガル語）
// 使い方: node build-audio.mjs のあとに node build-tracks.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { synthesize } from './azure-tts.mjs';

const JA_VOICE = 'ja-JP-NanamiNeural';

const here = dirname(fileURLToPath(import.meta.url));
const sandbox = { window: {} };
vm.runInNewContext(readFileSync(join(here, 'words.js'), 'utf8'), sandbox);
const { PT_CATEGORIES: categories, PT_AUDIO_DIR, ptAudioId } = sandbox.window;

const jaDir = join(here, 'audio-ja');
const trackDir = join(here, 'tracks');
const listFile = join(tmpdir(), 'pt-track-list.txt');
const silence = join(tmpdir(), 'pt-track-silence.mp3');
mkdirSync(jaDir, { recursive: true });
mkdirSync(trackDir, { recursive: true });

const indexFile = join(here, 'tracks.js');
const previous = existsSync(indexFile)
  ? JSON.parse(readFileSync(indexFile, 'utf8').replace(/^window\.PT_TRACKS = /, '').replace(/;\s*$/, ''))
  : {};

execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', '1', '-b:a', '48k', silence]);

const tracks = {};
for (const cat of categories) {
  const out = join(trackDir, `${cat.id}.m4a`);
  const version = ptAudioId(JSON.stringify(cat.words.map(([pt, ja]) => [pt, ja])));
  if (previous[cat.id]?.version === version && existsSync(out)) {
    tracks[cat.id] = previous[cat.id];
    continue;
  }
  const lines = [];
  for (const [pt, ja] of cat.words) {
    const jaFile = join(jaDir, `${ptAudioId(ja)}.mp3`);
    if (!existsSync(jaFile)) writeFileSync(jaFile, await synthesize(ja, JA_VOICE, 'ja-JP'));
    const ptFile = join(here, PT_AUDIO_DIR, `${ptAudioId(pt)}.mp3`);
    for (const file of [ptFile, silence, jaFile, ptFile]) lines.push(`file '${file}'`);
  }
  writeFileSync(listFile, lines.join('\n'));
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
    '-ar', '24000', '-ac', '1', '-c:a', 'aac', '-b:a', '48k', '-movflags', '+faststart', out]);
  const seconds = Math.round(Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString()));
  tracks[cat.id] = { version, seconds };
  writeFileSync(indexFile, `window.PT_TRACKS = ${JSON.stringify(tracks, null, 2)};\n`);
  console.log(`${cat.name}: ${Math.round(seconds / 60)}分`);
}

writeFileSync(indexFile, `window.PT_TRACKS = ${JSON.stringify(tracks, null, 2)};\n`);
rmSync(silence);
rmSync(listFile);
const total = Object.values(tracks).reduce((n, t) => n + t.seconds, 0);
console.log(`トラック ${Object.keys(tracks).length} 本 / 合計 ${Math.round(total / 60)}分`);
