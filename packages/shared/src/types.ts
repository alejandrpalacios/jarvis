// Tipos compartidos entre el cerebro (Node) y la app (SvelteKit).
// Todas las fechas se guardan como epoch millis (number), no como
// Firestore Timestamp, para que el mismo tipo sirva en cliente y servidor
// sin conversiones.

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: ChatRole;
  content: string;
  createdAt: number;
  /** Solo aplica a mensajes de role 'user': si el cerebro ya lo proceso. */
  handled?: boolean;
  /** A que sesion de charla pertenece (ver session.ts). Opcional solo por
   * compatibilidad con mensajes viejos anteriores a este campo. */
  sessionId?: string;
}

/**
 * Fase "por momentos": en vez de una unica charla infinita, la conversacion
 * se corta en sesiones. Este documento (uno por conversationId) guarda cual
 * es la sesion activa ahora mismo; los mensajes viejos no se borran, solo
 * dejan de contar como contexto activo una vez que su sesion expira.
 */
export interface ConversationState {
  currentSessionId: string;
  lastActivityAt: number;
}

export interface MemoryFact {
  key: string;
  value: string;
  updatedAt: number;
}

/**
 * Fase 3+: dispositivos que corren un agente (PC, movil, el "ayudante"
 * siempre encendido que manda el Wake-on-LAN). No se usa todavia, pero el
 * esquema de datos queda listo para no tener que migrar despues.
 */
export type DeviceKind = 'pc' | 'phone' | 'helper';

export interface DeviceInfo {
  id: string;
  name: string;
  kind: DeviceKind;
  online: boolean;
  lastSeen: number;
}

export type CommandStatus = 'pending' | 'done' | 'error';

export interface DeviceCommand {
  deviceId: string;
  action: string;
  payload?: Record<string, unknown>;
  status: CommandStatus;
  createdAt: number;
  result?: string;
}
