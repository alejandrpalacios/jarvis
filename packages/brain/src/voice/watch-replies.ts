// Lee en voz alta cada respuesta nueva de Jarvis, sin importar si el
// mensaje del usuario llego por voz (wake-agent) o por la app web. Es el
// complemento del wake-agent: uno escucha, este otro habla.
import { db } from '../firebase.js';
import { COLLECTIONS, CONVERSATION_ID } from '@jarvis/shared';
import { say } from './say.js';

export function watchRepliesAndSpeak(): void {
  const messagesRef = db.collection(COLLECTIONS.conversations).doc(CONVERSATION_ID).collection('messages');
  let sawInitial = false;
  let lastSeenId: string | null = null;

  messagesRef.orderBy('createdAt', 'asc').onSnapshot(
    (snapshot) => {
      const docs = snapshot.docs;
      if (!docs.length) return;
      const last = docs[docs.length - 1]!;

      if (!sawInitial) {
        // No leemos el historial que ya existia al arrancar.
        lastSeenId = last.id;
        sawInitial = true;
        return;
      }
      if (last.id === lastSeenId) return;
      lastSeenId = last.id;

      const data = last.data();
      if (data.role === 'assistant') {
        void say(String(data.content ?? ''));
      }
    },
    (err) => console.error('[wake-agent] Error escuchando respuestas para leer en voz alta:', err)
  );
}
