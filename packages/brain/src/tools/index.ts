import { db } from '../firebase.js';
import { COLLECTIONS } from '@jarvis/shared';

// Definimos las herramientas como un objeto plano en vez de usar los tipos
// exactos del SDK de Groq (son estrictos y calcados de OpenAI). Al llamarlas
// se castea a `any`; no vale la pena pelear con esos tipos para esta v1.
interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export const toolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'get_current_datetime',
      description: 'Devuelve la fecha y hora actual.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remember',
      description:
        'Guarda un dato duradero sobre el usuario o su contexto para recordarlo en conversaciones futuras.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Identificador corto y estable, ej. "pc_modelo"' },
          value: { type: 'string', description: 'El dato en si' },
        },
        required: ['key', 'value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'forget',
      description: 'Elimina un dato guardado previamente con "remember".',
      parameters: {
        type: 'object',
        properties: { key: { type: 'string' } },
        required: ['key'],
      },
    },
  },
];

export async function runTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'get_current_datetime':
      return new Date().toLocaleString('es-ES', { dateStyle: 'full', timeStyle: 'short' });

    case 'remember': {
      const key = String(args.key);
      const value = String(args.value);
      await db.collection(COLLECTIONS.memory).doc(key).set({
        key,
        value,
        updatedAt: Date.now(),
      });
      return `Guardado: ${key} = ${value}`;
    }

    case 'forget': {
      const key = String(args.key);
      await db.collection(COLLECTIONS.memory).doc(key).delete();
      return `Olvidado: ${key}`;
    }

    default:
      return `Herramienta desconocida: ${name}`;
  }
}
