// Reconocimiento y sintesis de voz usando las APIs nativas del navegador.
// Cero dependencias, cero backend nuevo: funciona ya mismo en Chrome/Edge.
// Firefox no soporta SpeechRecognition; Brave puede bloquearlo segun Shields.
//
// Esto es "pulsa el microfono y habla", no un wake-word en segundo plano --
// eso necesita un proceso que siga escuchando aunque cierres la pestana,
// lo cual encaja mejor con el agente de PC de la Fase 3.
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

export function speak(text: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = LANG;
  utterance.rate = 1.02;
  utterance.pitch = 0.9;
  const voice = pickSpanishVoice();
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}
