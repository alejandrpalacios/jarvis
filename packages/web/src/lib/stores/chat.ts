import { writable } from 'svelte/store';
import { collection, onSnapshot, orderBy, query, addDoc } from 'firebase/firestore';
import { db } from '$lib/firebase';
import { CONVERSATION_ID, type ChatRole } from '@jarvis/shared';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
}

export const messages = writable<ChatMessage[]>([]);

let unsubscribe: (() => void) | null = null;

/** Se suscribe una sola vez; llamadas repetidas devuelven la misma funcion. */
export function subscribeToChat(): () => void {
  if (unsubscribe) return unsubscribe;
  const q = query(
    collection(db, 'conversations', CONVERSATION_ID, 'messages'),
    orderBy('createdAt', 'asc')
  );
  unsubscribe = onSnapshot(q, (snap) => {
    messages.set(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ChatMessage, 'id'>) })));
  });
  return unsubscribe;
}

export async function sendMessage(content: string): Promise<void> {
  const trimmed = content.trim();
  if (!trimmed) return;
  await addDoc(collection(db, 'conversations', CONVERSATION_ID, 'messages'), {
    role: 'user',
    content: trimmed,
    createdAt: Date.now(),
    handled: false,
  });
}
