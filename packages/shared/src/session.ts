import type { ConversationState } from './types.js';

// Cuanto tiempo de silencio hace falta para considerar la charla "terminada"
// y arrancar una sesion nueva la proxima vez que alguien diga algo. No borra
// nada de Firestore: los mensajes viejos se quedan ahi archivados, solo dejan
// de leerse como contexto (asi Jarvis no mezcla una conversacion de hace 3
// dias con lo que le estas preguntando ahora).
export const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutos

export function newSessionId(now: number = Date.now()): string {
  return `session_${now}`;
}

/**
 * Dado el estado guardado (o nada, si es la primera vez) decide si toca
 * seguir en la misma sesion o abrir una nueva. Es una funcion pura para que
 * tanto el brain (Admin SDK) como la web (Client SDK) tomen exactamente la
 * misma decision sin duplicar la regla de negocio.
 */
export function resolveSessionId(
  state: ConversationState | undefined,
  now: number = Date.now(),
  timeoutMs: number = SESSION_TIMEOUT_MS
): { sessionId: string; isNew: boolean } {
  if (!state || now - state.lastActivityAt > timeoutMs) {
    return { sessionId: newSessionId(now), isNew: true };
  }
  return { sessionId: state.currentSessionId, isNew: false };
}
