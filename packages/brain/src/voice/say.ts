import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAY_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'say.ps1');

let speaking = false;

/** True mientras Jarvis esta hablando por los parlantes del PC. */
export function isSpeaking(): boolean {
  return speaking;
}

/**
 * Lee un texto en voz alta por los parlantes del PC usando la voz de
 * Windows (SAPI5) -- no es la voz "Online Natural" que usa el navegador
 * (esa API no esta expuesta fuera del navegador), asi que suena algo
 * mas clasica. La promesa no resuelve hasta que termina de hablar.
 */
export async function say(text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;

  speaking = true;
  const tmpFile = path.join(os.tmpdir(), `jarvis-say-${Date.now()}.txt`);
  await writeFile(tmpFile, trimmed, 'utf-8');
  try {
    await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${SAY_SCRIPT}" -TextFile "${tmpFile}"`);
  } finally {
    await unlink(tmpFile).catch(() => {});
    speaking = false;
  }
}
