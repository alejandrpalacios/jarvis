import 'dotenv/config';
import { db } from './firebase.js';
import { generateReply } from './conversation.js';
import { COLLECTIONS, CONVERSATION_ID } from '@jarvis/shared';
import { startWakeAgent } from './voice/wake-agent.js';
import { watchRepliesAndSpeak } from './voice/watch-replies.js';

const messagesRef = db
  .collection(COLLECTIONS.conversations)
  .doc(CONVERSATION_ID)
  .collection('messages');

// Cola simple para no procesar dos mensajes de usuario en paralelo (si
// mandas dos seguidos, se contestan en orden en vez de pisarse).
let busy = false;
const pending: string[] = [];

async function processMessage(docId: string) {
  const doc = await messagesRef.doc(docId).get();
  const data = doc.data();
  if (!data || data.role !== 'user' || data.handled) return;

  // Marcamos como manejado ANTES de llamar al modelo para que un reinicio
  // del brain a mitad de proceso no lo vuelva a contestar dos veces.
  await messagesRef.doc(docId).update({ handled: true });

  try {
    const reply = await generateReply(CONVERSATION_ID);
    await messagesRef.add({
      role: 'assistant',
      content: reply,
      createdAt: Date.now(),
    });
  } catch (err) {
    console.error('[jarvis-brain] Error generando respuesta:', err);
    await messagesRef.add({
      role: 'assistant',
      content: `Se me cruzaron los cables (${(err as Error).message}). Revisa la consola del cerebro.`,
      createdAt: Date.now(),
    });
  }
}

async function drainQueue() {
  if (busy) return;
  busy = true;
  while (pending.length) {
    const id = pending.shift()!;
    await processMessage(id);
  }
  busy = false;
}

messagesRef
  .where('role', '==', 'user')
  .where('handled', '==', false)
  .onSnapshot(
    (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added' || change.type === 'modified') {
          pending.push(change.doc.id);
        }
      });
      void drainQueue();
    },
    (err) => {
      console.error('[jarvis-brain] Error escuchando Firestore:', err);
      console.error(
        'Si el error menciona un indice compuesto, abre el enlace que trae el mensaje para crearlo (un solo clic).'
      );
    }
  );

console.log(`[jarvis-brain] Escuchando conversacion "${CONVERSATION_ID}"... Ctrl+C para apagar.`);

// Manos libres nativo: si no hay PICOVOICE_ACCESS_KEY configurada, esto
// se queda callado y todo lo demas sigue funcionando igual.
watchRepliesAndSpeak();
void startWakeAgent().catch((err) => console.error('[wake-agent] No pudo arrancar:', err));
