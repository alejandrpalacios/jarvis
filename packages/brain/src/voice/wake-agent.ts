// Agente de voz nativo: escucha el microfono del sistema operativo todo
// el tiempo (no depende de ninguna ventana de navegador abierta) y
// reacciona a la palabra "Jarvis". Al detectarla, graba lo que sigas
// diciendo, lo transcribe con Groq Whisper, y lo mete como un mensaje
// de usuario mas en la MISMA conversacion de Firestore -- el brain ya
// esta escuchando esa coleccion y le contesta como si lo hubieras
// escrito o hablado desde la app. No hace falta logica de IA aqui.
import { Porcupine, BuiltinKeyword } from '@picovoice/porcupine-node';
import { PvRecorder } from '@picovoice/pvrecorder-node';
import { writeFile, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Groq from 'groq-sdk';
import { db } from '../firebase.js';
import { COLLECTIONS, CONVERSATION_ID } from '@jarvis/shared';
import { say, isSpeaking } from './say.js';
import { framesToWav } from './wav.js';
import { getActiveSessionId } from '../session.js';

const SILENCE_MS = 900; // silencio despues de hablar para dar el comando por terminado
const MAX_COMMAND_MS = 8000; // limite duro por si la deteccion de silencio falla
const MIN_LISTEN_MS = 4000; // si no dice nada en este tiempo, se cancela
const AMPLITUDE_THRESHOLD = 600; // umbral de "hay voz" sobre el ruido de fondo (ajustable)

async function recordCommand(recorder: PvRecorder, sampleRate: number, frameMs: number): Promise<Buffer | null> {
  const frames: Int16Array[] = [];
  let heardSpeech = false;
  let silentMs = 0;
  let elapsedMs = 0;

  while (elapsedMs < MAX_COMMAND_MS) {
    const frame = await recorder.read();
    frames.push(Int16Array.from(frame));
    elapsedMs += frameMs;

    const maxAmp = frame.reduce((m, s) => Math.max(m, Math.abs(s)), 0);
    if (maxAmp > AMPLITUDE_THRESHOLD) {
      heardSpeech = true;
      silentMs = 0;
    } else if (heardSpeech) {
      silentMs += frameMs;
      if (silentMs >= SILENCE_MS) break;
    } else if (elapsedMs >= MIN_LISTEN_MS) {
      return null; // nunca hablo despues de "Dime.": se cancela
    }
  }

  return heardSpeech ? framesToWav(frames, sampleRate) : null;
}

async function transcribe(wav: Buffer, groq: Groq): Promise<string> {
  const tmpFile = path.join(os.tmpdir(), `jarvis-cmd-${Date.now()}.wav`);
  await writeFile(tmpFile, wav);
  try {
    const result = await groq.audio.transcriptions.create({
      file: createReadStream(tmpFile) as unknown as File,
      model: 'whisper-large-v3',
      language: 'es',
    });
    return (result.text ?? '').trim();
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}

export async function startWakeAgent(): Promise<void> {
  const accessKey = process.env.PICOVOICE_ACCESS_KEY;
  const groqKey = process.env.GROQ_API_KEY;

  if (!accessKey) {
    console.log('[wake-agent] PICOVOICE_ACCESS_KEY no configurada -- modo manos libres nativo desactivado.');
    return;
  }

  const porcupine = new Porcupine(accessKey, [BuiltinKeyword.JARVIS], [0.6]);
  const recorder = new PvRecorder(porcupine.frameLength);
  const groq = new Groq({ apiKey: groqKey });
  const frameMs = (porcupine.frameLength / porcupine.sampleRate) * 1000;

  const messagesRef = db.collection(COLLECTIONS.conversations).doc(CONVERSATION_ID).collection('messages');

  let running = true;
  process.on('SIGINT', () => {
    running = false;
  });

  recorder.start();
  console.log('[wake-agent] Escuchando "Jarvis" por el microfono del sistema...');

  try {
    while (running) {
      const frame = await recorder.read();
      if (isSpeaking()) continue; // no te escuches a ti mismo mientras hablas

      const keywordIndex = porcupine.process(frame);
      if (keywordIndex === -1) continue;

      await say('Dime.');
      const wav = await recordCommand(recorder, porcupine.sampleRate, frameMs);
      if (!wav) continue; // no dijo nada util, vuelve a esperar "Jarvis"

      try {
        const text = await transcribe(wav, groq);
        if (text) {
          const sessionId = await getActiveSessionId(CONVERSATION_ID);
          await messagesRef.add({
            role: 'user',
            content: text,
            createdAt: Date.now(),
            handled: false,
            sessionId,
          });
        }
      } catch (err) {
        console.error('[wake-agent] Error transcribiendo el comando:', err);
      }
    }
  } finally {
    try {
      recorder.stop();
      recorder.release();
    } catch {
      // ya se estaba cerrando de todas formas
    }
    porcupine.release();
  }
}
