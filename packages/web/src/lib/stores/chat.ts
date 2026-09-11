import { writable } from 'svelte/store';
import {
  collection,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  orderBy,
  query,
  where,
  addDoc,
} from 'firebase/firestore';
import { db } from '$lib/firebase';
import {
  CONVERSATION_ID,
  resolveSessionId,
  newSessionId,
  type ChatRole,
  type ConversationState,
} from '@jarvis/shared';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
}

export const messages = writable<ChatMessage[]>([]);
// Sesion que se esta mostrando/usando ahora mismo. Cambia sola cuando la
// charla anterior expiro por inactividad, o cuando se llama a
// startNewSession(). Los mensajes de sesiones viejas no se borran de
// Firestore, solo dejan de aparecer aqui.
export const currentSessionId = writable<string | null>(null);

const stateRef = doc(db, 'conversations', CONVERSATION_ID);

let unsubState: (() => void) | null = null;
let unsubMessages: (() => void) | null = null;

function watchSession(sessionId: string) {
  unsubMessages?.();
  const q = query(
    collection(db, 'conversations', CONVERSATION_ID, 'messages'),
    where('sessionId', '==', sessionId),
    orderBy('createdAt', 'asc')
  );
  unsubMessages = onSnapshot(q, (snap) => {
    messages.set(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ChatMessage, 'id'>) })));
  });
}

/** Se suscribe una sola vez; llamadas repetidas devuelven la misma funcion. */
export function subscribeToChat(): () => void {
  if (unsubState) {
    return () => {
      unsubState?.();
      unsubMessages?.();
    };
  }

  unsubState = onSnapshot(stateRef, (snap) => {
    const state = snap.exists() ? (snap.data() as ConversationState) : undefined;
    // Solo miramos, no decidimos sesion nueva aca (eso lo hace quien manda
    // el mensaje) -- si no hay ninguna todavia, no hay nada que mostrar.
    const id = state?.currentSessionId ?? null;
    currentSessionId.set(id);
    if (id) watchSession(id);
    else messages.set([]);
  });

  return () => {
    unsubState?.();
    unsubMessages?.();
    unsubState = null;
    unsubMessages = null;
  };
}

/** Resuelve la sesion activa (creando una si hacia falta) y devuelve su id. */
async function ensureActiveSession(): Promise<string> {
  const snap = await getDoc(stateRef);
  const state = snap.exists() ? (snap.data() as ConversationState) : undefined;
  const now = Date.now();
  const { sessionId } = resolveSessionId(state, now);
  await setDoc(stateRef, { currentSessionId: sessionId, lastActivityAt: now }, { merge: true });
  return sessionId;
}

export async function sendMessage(content: string): Promise<void> {
  const trimmed = content.trim();
  if (!trimmed) return;
  const sessionId = await ensureActiveSession();
  await addDoc(collection(db, 'conversations', CONVERSATION_ID, 'messages'), {
    role: 'user',
    content: trimmed,
    createdAt: Date.now(),
    handled: false,
    sessionId,
  });
}

/** Corta la charla actual y empieza una nueva de cero, sin arrastrar contexto. */
export async function startNewSession(): Promise<void> {
  const now = Date.now();
  await setDoc(stateRef, { currentSessionId: newSessionId(now), lastActivityAt: now }, { merge: true });
}
