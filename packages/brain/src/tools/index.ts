import { db } from '../firebase.js';
import { COLLECTIONS } from '@jarvis/shared';
import { openApp, closeApp, systemVolume, systemInfo, listFiles, openPath } from './pc.js';

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
  {
    type: 'function',
    function: {
      name: 'open_app',
      description:
        'Abre cualquier aplicacion instalada en el PC del usuario. Busca por parecido en el indice real de apps instaladas, asi que no hace falta el nombre exacto -- intenta con lo que el usuario diga tal cual.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Nombre o parte del nombre de la app, tal como lo dijo el usuario' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'close_app',
      description: 'Cierra (fuerza el cierre de) una aplicacion conocida que este abierta en el PC del usuario.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Nombre de la app, ej. "whatsapp", "spotify", "chrome"' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'system_volume',
      description: 'Controla el volumen o la reproduccion de medios del PC.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['up', 'down', 'mute', 'play', 'pause', 'next', 'previous'],
          },
          steps: { type: 'number', description: 'Cuantas veces repetir para up/down (por defecto 5, ~10%)' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'system_info',
      description:
        'Consulta informacion de solo lectura del PC: RAM libre, espacio en disco, y los procesos que mas CPU consumen ahora mismo.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'Lista los archivos mas recientes dentro de una carpeta permitida del usuario.',
      parameters: {
        type: 'object',
        properties: {
          folder: { type: 'string', enum: ['descargas', 'escritorio', 'documentos'] },
        },
        required: ['folder'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_path',
      description: 'Abre una carpeta permitida (o un archivo especifico dentro de ella) en el Explorador de Windows.',
      parameters: {
        type: 'object',
        properties: {
          folder: { type: 'string', enum: ['descargas', 'escritorio', 'documentos'] },
          filename: {
            type: 'string',
            description: 'Nombre exacto del archivo (opcional; si se omite, abre la carpeta)',
          },
        },
        required: ['folder'],
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

    case 'open_app':
      return openApp(String(args.name));

    case 'close_app':
      return closeApp(String(args.name));

    case 'system_volume':
      return systemVolume(String(args.action), args.steps ? Number(args.steps) : undefined);

    case 'system_info':
      return systemInfo();

    case 'list_files':
      return listFiles(String(args.folder));

    case 'open_path':
      return openPath(String(args.folder), args.filename ? String(args.filename) : undefined);

    default:
      return `Herramienta desconocida: ${name}`;
  }
}
