// words.js を点検し、足りない音声を Azure の声で作る
// 使い方: node build-audio.mjs
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { synthesize } from './azure-tts.mjs';

const VOICE = 'pt-PT-FernandaNeural';

const here = dirname(fileURLToPath(import.meta.url));
const sandbox = { window: {} };
vm.runInNewContext(readFileSync(join(here, 'words.js'), 'utf8'), sandbox);
const { PT_CATEGORIES: categories, PT_AUDIO_DIR, ptAudioId, ptSpoken } = sandbox.window;
const audioDir = join(here, PT_AUDIO_DIR);

// ブラジル式の語や表現が例文に混ざっていないかを見る
const brazilian = /\b(ônibus|celular|banheiro|geladeira|trem|café da manhã|aluguel|endereço|você|vômito|gerente de banco)\b|\b(?!quando\b|mando\b|comando\b|grando\b|lindo\b|vindo\b)\p{L}+(ando|endo|indo)\b/iu;
const problems = [];
const seen = new Map();
const texts = new Set();

for (const cat of categories) {
  for (const [pt, ja, exPt, exJa] of cat.words) {
    if (!pt || !ja) problems.push(`空欄: ${cat.id} ${pt}`);
    if (Boolean(exPt) !== Boolean(exJa)) problems.push(`例文か訳が片方だけ: ${pt}`);
    if (seen.has(pt)) problems.push(`重複: ${pt}（${seen.get(pt)} と ${cat.id}）`);
    seen.set(pt, cat.id);
    for (const text of [pt, exPt]) {
      if (!text) continue;
      if (brazilian.test(text)) problems.push(`ブラジル式の疑い: ${text}`);
      texts.add(text);
    }
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}

mkdirSync(audioDir, { recursive: true });
const wanted = new Set();
let made = 0;

for (const text of texts) {
  const file = `${ptAudioId(text)}.mp3`;
  if (wanted.has(file)) continue;
  wanted.add(file);
  const out = join(audioDir, file);
  if (existsSync(out)) continue;
  const audio = await synthesize(ptSpoken(text), VOICE, 'pt-PT');
  writeFileSync(out, audio);
  made++;
  if (made % 50 === 0) console.log(`${made} 個作成`);
}

// words.js から消えた語の音声を片づける
let removed = 0;
for (const file of readdirSync(audioDir)) {
  if (!wanted.has(file)) {
    rmSync(join(audioDir, file));
    removed++;
  }
}

const total = categories.reduce((n, c) => n + c.words.length, 0);
console.log(`語数 ${total} / 音声 ${wanted.size}（新規 ${made}、削除 ${removed}）`);
