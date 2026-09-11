// Resuelve/mantiene la sesion activa de una conversacion usando el Admin
// SDK. Lo usan tanto el listener de mensajes de la app (index.ts) como el
// wake-agent nativo -- ambos necesitan saber "a que sesion pertenece esto"
// antes de guardar un mensaje de usuario.
import { db } from './firebase.js';
import { COLLECTIONS, resolveSessionId, type ConversationState } from '@jarvis/shared';

/**
 * Devuelve la sesion activa para conversationId, creando una nueva si no
 * habia ninguna o si la anterior ya expiro por inactividad (ver
 * SESSION_TIMEOUT_MS en @jarvis/shared). Tambien deja el reloj de
 * "ultima actividad" al dia para que la proxima llamada decida bien.
 */
export async function getActiveSessionId(conversationId: string): Promise<string> {
  const ref = db.collection(COLLECTIONS.conversations).doc(conversationId);
  const snap = await ref.get();
  const state = snap.exists ? (snap.data() as ConversationState) : undefined;

  const now = Date.now();
  const { sessionId } = resolveSessionId(state, now);

  await ref.set({ currentSessionId: sessionId, lastActivityAt: now }, { merge: true });
  return sessionId;
}
