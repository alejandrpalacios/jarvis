import { groq, GROQ_MODEL } from './groq.js';
import { toolDefinitions, runTool } from './tools/index.js';
import { db } from './firebase.js';
import { COLLECTIONS, buildSystemPrompt, type ChatMessage } from '@jarvis/shared';

const USER_NAME = process.env.JARVIS_USER_NAME ?? 'Alejandro';
const HISTORY_LIMIT = 20;
const MAX_TOOL_ROUNDS = 4;

async function loadMemoryBlock(): Promise<string> {
  const snap = await db.collection(COLLECTIONS.memory).get();
  if (snap.empty) return '';
  const facts = snap.docs.map((d) => `- ${d.id}: ${d.data().value}`).join('\n');
  return `\n\nCOSAS QUE YA SABES DE ${USER_NAME.toUpperCase()}:\n${facts}`;
}

async function loadHistory(conversationId: string): Promise<ChatMessage[]> {
  const snap = await db
    .collection(COLLECTIONS.conversations)
    .doc(conversationId)
    .collection('messages')
    .orderBy('createdAt', 'asc')
    .limitToLast(HISTORY_LIMIT)
    .get();
  return snap.docs.map((d) => d.data() as ChatMessage);
}

/**
 * Genera la respuesta de Jarvis para el estado actual de la conversacion.
 * Corre un mini loop de tool-calling: si el modelo pide ejecutar una
 * herramienta, la corremos y le devolvemos el resultado hasta que conteste
 * en texto normal (o hasta MAX_TOOL_ROUNDS, para no quedar en bucle).
 */
export async function generateReply(conversationId: string): Promise<string> {
  const [memoryBlock, history] = await Promise.all([loadMemoryBlock(), loadHistory(conversationId)]);

  const systemPrompt =
    buildSystemPrompt({
      userName: USER_NAME,
      capabilities: [
        'Conversar, razonar y ayudarte a pensar en lo que necesites.',
        'Recordar datos que le pidas guardar, y usarlos despues sin que se los repitas.',
        'Abrir y cerrar aplicaciones conocidas en tu PC (navegadores, Spotify, VS Code, WhatsApp, Discord...).',
        'Subir/bajar el volumen y controlar reproduccion de medios (play, pausa, siguiente, anterior) en tu PC.',
        'Consultar el estado de tu PC: RAM libre, espacio en disco, procesos que mas CPU consumen.',
        'Listar y abrir archivos dentro de Descargas, Escritorio o Documentos (no fuera de esas carpetas).',
      ],
    }) + memoryBlock;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const completion = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages,
      tools: toolDefinitions as never,
      tool_choice: 'auto',
    });

    const choice = completion.choices[0];
    const msg = choice.message;

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return msg.content ?? 'No se me ocurre que decir, y eso ya es raro en mi.';
    }

    messages.push(msg);
    for (const call of msg.tool_calls) {
      const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      const result = await runTool(call.function.name, args);
      messages.push({ role: 'tool', tool_call_id: call.id, content: result });
    }
  }

  return 'Se me enredaron los cables encadenando herramientas. Intenta de nuevo con algo mas simple.';
}
