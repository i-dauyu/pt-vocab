// Azure Speech で文章を音声にする
// キーはリポジトリの外の ../.azure-speech.env に置く（GitHub に上げない）
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(readFileSync(join(here, '..', '.azure-speech.env'), 'utf8')
  .split('\n').filter((l) => l.includes('=')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }));

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export async function synthesize(text, voice, lang) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const res = await fetch(`https://${env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': env.AZURE_SPEECH_KEY,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'pt-vocab',
      },
      body: `<speak version="1.0" xml:lang="${lang}"><voice name="${voice}">${escapeXml(text)}</voice></speak>`,
    });
    if (res.ok) {
      const audio = Buffer.from(await res.arrayBuffer());
      if (audio.length < 1000) throw new Error(`音声が短すぎます: ${text}`);
      return audio;
    }
    if (res.status !== 429 && res.status < 500) throw new Error(`Azure ${res.status}: ${text}`);
    await wait(15000); // 無料プランの回数制限
  }
  throw new Error(`Azure が混み合って作れませんでした: ${text}`);
}
