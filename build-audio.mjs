// words.js を点検し、足りない音声を Azure の声で作る
// 使い方: node build-audio.mjs
// キーはリポジトリの外の ../.azure-speech.env に置く（GitHub に上げない）
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

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

const env = Object.fromEntries(readFileSync(join(here, '..', '.azure-speech.env'), 'utf8')
  .split('\n').filter((l) => l.includes('=')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }));

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

async function synthesize(text) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const res = await fetch(`https://${env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': env.AZURE_SPEECH_KEY,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'pt-vocab',
      },
      body: `<speak version="1.0" xml:lang="pt-PT"><voice name="${VOICE}">${escapeXml(ptSpoken(text))}</voice></speak>`,
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (res.status !== 429 && res.status < 500) throw new Error(`Azure ${res.status}: ${text}`);
    await wait(15000); // 無料プランの回数制限
  }
  throw new Error(`Azure が混み合って作れませんでした: ${text}`);
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
  const audio = await synthesize(text);
  if (audio.length < 1000) throw new Error(`音声が短すぎます: ${text}`);
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
