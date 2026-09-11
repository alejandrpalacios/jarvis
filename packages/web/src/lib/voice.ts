// Reconocimiento y sintesis de voz usando las APIs nativas del navegador.
// Cero dependencias, cero backend nuevo: funciona ya mismo en Chrome/Edge.
// Firefox no soporta SpeechRecognition; Brave puede bloquearlo segun Shields.
//
// Tambien incluye un modo "manos libres": escucha en continuo mientras la
// app este abierta y reacciona a la palabra "Jarvis". No es un wake-word
// nativo del sistema (eso seguiria necesitando un proceso aparte con
// captura de audio nativa, mas propio de la Fase 3) -- esto vive dentro de
// la pestana/ventana de la app, asi que deja de escuchar si la cierras o
// la minimizas del todo.
//
// Nota sobre calidad de voz: esto usa las voces que ya trae el sistema
// operativo/navegador. Elegimos la mejor disponible (las "Online Natural"
// de Edge o "Google" de Chrome suenan bastante bien), pero para una voz
// realmente cinematografica tipo Jarvis hay que pasarse a un TTS en la
// nube (ElevenLabs, etc.) -- eso es una Fase 2b, requiere backend propio
// porque esas claves no pueden ir en el navegador.

const LANG = 'es-ES';

function getRecognitionCtor(): any {
  if (typeof window === 'undefined') return null;
  return (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null;
}

export function isVoiceSupported(): boolean {
  return typeof window !== 'undefined' && getRecognitionCtor() !== null && 'speechSynthesis' in window;
}

/** Escucha una sola frase y resuelve con el texto transcrito. */
export function listenOnce(): Promise<string> {
  return new Promise((resolve, reject) => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      reject(new Error('Este navegador no soporta reconocimiento de voz.'));
      return;
    }
    const recognition = new Ctor();
    recognition.lang = LANG;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      const transcript = event.results?.[0]?.[0]?.transcript ?? '';
      resolve(String(transcript).trim());
    };
    recognition.onerror = (event: any) => {
      reject(new Error(event?.error ?? 'Error de reconocimiento de voz'));
    };
    recognition.onspeechend = () => recognition.stop();

    recognition.start();
  });
}

// Nombres que delatan una voz neuronal/natural de buena calidad, de mejor
// a peor preferencia. Todo lo que no matchee cae a cualquier voz es-* y,
// si no hay ninguna, a la voz por defecto del navegador.
const PREFERRED_NAME_HINTS = ['online (natural)', 'natural', 'google', 'multilingual'];

let cachedVoice: SpeechSynthesisVoice | null | undefined;

function pickSpanishVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice !== undefined) return cachedVoice;
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;

  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null; // Aun no cargaron; se reintenta en la siguiente llamada.

  const spanish = voices.filter((v) => v.lang?.toLowerCase().startsWith('es'));
  const pool = spanish.length ? spanish : voices;

  for (const hint of PREFERRED_NAME_HINTS) {
    const match = pool.find((v) => v.name.toLowerCase().includes(hint));
    if (match) {
      cachedVoice = match;
      return match;
    }
  }

  cachedVoice = pool[0] ?? null;
  return cachedVoice;
}

// En Chrome/Edge, getVoices() suele devolver [] hasta que dispara este
// evento la primera vez. Invalidamos el cache para volver a elegir bien.
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    cachedVoice = undefined;
  };
}

/** onEnd se dispara siempre al terminar de hablar (o si se corta a mitad). Sirve para que la UI sepa cuando el orbe deja de "hablar". */
export function speak(text: string, onEnd?: () => void): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text) {
    onEnd?.();
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = LANG;
  utterance.rate = 1.02;
  utterance.pitch = 0.9;
  const voice = pickSpanishVoice();
  if (voice) utterance.voice = voice;

  // Si el modo manos libres esta activo, paramos de escuchar mientras
  // Jarvis habla -- si no, el microfono podria captar su propia voz por
  // los parlantes y disparar falsos positivos (o peor, reaccionar a su
  // propia respuesta como si fuera un comando nuevo).
  const pauseWake = wakeShouldRun && wakeRecognition;
  if (pauseWake) {
    wakePausedForSpeech = true;
    try {
      wakeRecognition.stop();
    } catch {
      // ya estaba detenido; no pasa nada.
    }
  }

  utterance.onend = () => {
    if (pauseWake) {
      wakePausedForSpeech = false;
      if (wakeShouldRun) {
        try {
          wakeRecognition.start();
        } catch {
          // seguia corriendo por alguna razon; se ignora.
        }
      }
    }
    onEnd?.();
  };

  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

// --- Modo manos libres: "Jarvis" como palabra de activacion ----------------
// Variantes por si el reconocimiento de voz transcribe mal el nombre.
const WAKE_WORD_PATTERN = /\b(j?arvis|yarvis|harvis)\b/i;

export interface WakeWordEvents {
  /** Se dijo "Jarvis" sin un comando en el mismo aliento: hay que responder algo tipo "Dime". */
  onWake: () => void;
  /** Hay un comando listo para mandar (ya sea junto al wake word o en la frase siguiente). */
  onCommand: (text: string) => void;
  onError?: (message: string) => void;
}

let wakeRecognition: any = null;
let wakeShouldRun = false;
let wakeArmed = false; // true = ya desperto, esperando el comando en la siguiente frase
let wakeEvents: WakeWordEvents | null = null;
let wakePausedForSpeech = false;

function stripWakeWord(transcript: string): string {
  const match = transcript.match(WAKE_WORD_PATTERN);
  if (!match || match.index === undefined) return transcript;
  return transcript.slice(match.index + match[0].length).trim();
}

function handleFinalTranscript(transcript: string) {
  if (!wakeEvents) return;
  const trimmed = transcript.trim();
  if (!trimmed) return;

  if (!wakeArmed) {
    if (!WAKE_WORD_PATTERN.test(trimmed)) return; // no era para Jarvis, se ignora.
    const remainder = stripWakeWord(trimmed);
    if (remainder.length > 2) {
      wakeEvents.onCommand(remainder);
    } else {
      wakeArmed = true;
      wakeEvents.onWake();
    }
  } else {
    wakeArmed = false;
    wakeEvents.onCommand(trimmed);
  }
}

function createWakeRecognition(): any {
  const Ctor = getRecognitionCtor();
  if (!Ctor) return null;
  const recognition = new Ctor();
  recognition.lang = LANG;
  recognition.continuous = true;
  recognition.interimResults = false;

  recognition.onresult = (event: any) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        handleFinalTranscript(String(result[0]?.transcript ?? ''));
      }
    }
  };

  recognition.onerror = (event: any) => {
    if (event?.error === 'not-allowed' || event?.error === 'service-not-allowed') {
      wakeShouldRun = false;
      wakeEvents?.onError?.('Permiso de microfono denegado.');
    }
    // 'no-speech', 'aborted', etc. se recuperan solos en onend.
  };

  // continuous:true igual se corta cada tanto (silencios largos, limite
  // interno del navegador); mientras el modo siga activo, se reinicia solo.
  recognition.onend = () => {
    if (wakeShouldRun && !wakePausedForSpeech) {
      try {
        recognition.start();
      } catch {
        // ya estaba arrancado; se ignora.
      }
    }
  };

  return recognition;
}

/** Activa la escucha continua. Devuelve false si el navegador no lo soporta. */
export function startWakeWordMode(events: WakeWordEvents): boolean {
  if (!isVoiceSupported()) {
    events.onError?.('Este navegador no soporta el modo manos libres.');
    return false;
  }
  stopWakeWordMode();
  wakeEvents = events;
  wakeShouldRun = true;
  wakeArmed = false;
  wakeRecognition = createWakeRecognition();
  try {
    wakeRecognition.start();
    return true;
  } catch (err) {
    events.onError?.((err as Error).message);
    return false;
  }
}

export function stopWakeWordMode(): void {
  wakeShouldRun = false;
  wakeArmed = false;
  wakeEvents = null;
  try {
    wakeRecognition?.stop();
  } catch {
    // ignorar
  }
  wakeRecognition = null;
}
