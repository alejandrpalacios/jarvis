// Reconocimiento y sintesis de voz usando las APIs nativas del navegador.
// Cero dependencias, cero backend nuevo: funciona ya mismo en Chrome/Edge.
// Firefox no soporta SpeechRecognition; Brave puede bloquearlo segun Shields.
//
// Esto es "pulsa el microfono y habla", no un wake-word en segundo plano --
// eso necesita un proceso que siga escuchando aunque cierres la pestana,
// lo cual encaja mejor con el agente de PC de la Fase 3.

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

export function speak(text: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = LANG;
  utterance.rate = 1.05;
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}
