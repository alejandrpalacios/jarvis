// Herramientas de control del PC. Todo lo peligroso (rutas libres, comandos
// arbitrarios) queda deliberadamente fuera: el modelo solo puede elegir
// entre listas blancas fijas, nunca inyectar un comando propio.
//
// Nota de arquitectura: como el "brain" corre en el mismo PC que queremos
// controlar (no en la nube), estas herramientas ejecutan directo aqui con
// Node -- no hace falta el relay de Firestore (devices/commands) que se
// dejo modelado en @jarvis/shared para el dia que el brain viva en otra
// maquina o para controlar el movil.

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LAUNCH_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'launch-app.ps1');

// --- Abrir aplicaciones ---------------------------------------------------
// En vez de una lista fija de comandos, consultamos el mismo indice que
// usa el menu Inicio de Windows (Get-StartApps) y elegimos la app cuyo
// nombre mas se parezca a lo que pidio el usuario. Esto cubre TODO lo
// instalado (clasico o de Microsoft Store) sin tener que listar cada app
// a mano, y la ejecucion sigue siendo "lista blanca": el modelo nunca
// puede lanzar nada que no exista de verdad en ese indice.

interface StartApp {
  Name: string;
  AppID: string;
}

// Quita acentos (via NFD + rango de marcas diacriticas combinantes) para
// que "Bloc de notas" y "bloc de notas" -- o "Notion" y "notion" -- matcheen
// sin importar tildes.
const DIACRITICS = /[̀-ͯ]/g;

function normalize(s: string): string {
  return s.normalize('NFD').replace(DIACRITICS, '').toLowerCase().trim();
}

async function getStartApps(): Promise<StartApp[]> {
  const { stdout } = await execAsync('powershell -NoProfile -Command "Get-StartApps | ConvertTo-Json -Compress"');
  const parsed = JSON.parse(stdout);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function findBestMatch(query: string, apps: StartApp[]): { app: StartApp | null; alternatives: string[] } {
  const q = normalize(query);
  const contains: StartApp[] = [];
  const scored: { app: StartApp; score: number }[] = [];

  for (const app of apps) {
    const n = normalize(app.Name);
    if (n === q) return { app, alternatives: [] };
    if (n.includes(q) || q.includes(n)) contains.push(app);

    const qWords = new Set(q.split(/\s+/).filter(Boolean));
    const overlap = n.split(/\s+/).filter((w) => qWords.has(w)).length;
    if (overlap > 0) scored.push({ app, score: overlap });
  }

  if (contains.length) {
    contains.sort((a, b) => a.Name.length - b.Name.length);
    return { app: contains[0], alternatives: contains.slice(1, 4).map((a) => a.Name) };
  }

  scored.sort((a, b) => b.score - a.score);
  if (scored.length) {
    return { app: scored[0].app, alternatives: scored.slice(1, 4).map((s) => s.app.Name) };
  }

  return { app: null, alternatives: [] };
}

async function launchAndMinimize(appId: string): Promise<boolean> {
  const { stdout } = await execAsync(
    `powershell -NoProfile -ExecutionPolicy Bypass -File "${LAUNCH_SCRIPT}" -AppId "${appId}"`
  );
  try {
    return Boolean(JSON.parse(stdout).minimized);
  } catch {
    return false;
  }
}

export async function openApp(name: string): Promise<string> {
  let apps: StartApp[];
  try {
    apps = await getStartApps();
  } catch (err) {
    return `No pude consultar las apps instaladas: ${(err as Error).message}`;
  }

  const { app, alternatives } = findBestMatch(name, apps);
  if (!app) {
    return `No encontre nada parecido a "${name}" entre tus apps instaladas. Dime el nombre exacto tal como aparece en el menu Inicio.`;
  }

  try {
    const minimized = await launchAndMinimize(app.AppID);
    const nota = app.Name.toLowerCase() !== name.trim().toLowerCase() ? ` (encontre "${app.Name}")` : '';
    const alt = alternatives.length ? ` Tambien pude referirme a: ${alternatives.join(', ')}.` : '';
    return `Abriendo ${app.Name}${nota}${minimized ? ', minimizada para no interrumpirte' : ''}.${alt}`;
  } catch (err) {
    return `Encontre "${app.Name}" pero no pude abrirla: ${(err as Error).message}`;
  }
}

// Nombres de proceso reales (para taskkill) -- distinto del comando de
// apertura, por eso es un mapa separado. Las apps de Microsoft Store
// (Spotify, WhatsApp) no tienen un nombre de proceso fijo y predecible
// (ej. "WhatsApp.Root.exe", "SpotifyLauncher.exe"), asi que usamos
// comodines -- taskkill los soporta de forma nativa en /IM.
const PROCESS_IMAGE_NAMES: Record<string, string> = {
  spotify: 'Spotify*',
  chrome: 'chrome.exe',
  'google chrome': 'chrome.exe',
  brave: 'brave.exe',
  edge: 'msedge.exe',
  'microsoft edge': 'msedge.exe',
  'vs code': 'Code.exe',
  'visual studio code': 'Code.exe',
  code: 'Code.exe',
  notepad: 'notepad.exe',
  whatsapp: 'WhatsApp*',
  discord: 'Discord.exe',
  word: 'winword.exe',
  excel: 'excel.exe',
};

export async function closeApp(name: string): Promise<string> {
  const key = name.trim().toLowerCase();
  const image = PROCESS_IMAGE_NAMES[key];
  if (!image) {
    return `No tengo "${name}" en mi lista de aplicaciones que puedo cerrar. Las que si conozco: ${Object.keys(PROCESS_IMAGE_NAMES).join(', ')}.`;
  }
  try {
    await execAsync(`taskkill /IM "${image}" /F`);
    return `${name} cerrado.`;
  } catch (err) {
    // taskkill devuelve codigo 128 cuando el proceso no estaba corriendo --
    // eso no es un fallo real, solo informativo.
    if ((err as { code?: number }).code === 128) {
      return `${name} no estaba abierto.`;
    }
    return `No pude cerrar ${name}: ${(err as Error).message}`;
  }
}

// --- Volumen y medios ------------------------------------------------------
// Simula las teclas multimedia via SendKeys -- Windows las intercepta a
// nivel de sistema sin importar que ventana tenga el foco.
const VOLUME_KEYS: Record<string, number> = {
  up: 175,
  down: 174,
  mute: 173,
  play: 179,
  pause: 179,
  next: 176,
  previous: 177,
};

export async function systemVolume(action: string, steps?: number): Promise<string> {
  const key = action.trim().toLowerCase();
  const code = VOLUME_KEYS[key];
  if (!code) {
    return `No reconozco la accion de volumen "${action}". Opciones: up, down, mute, play, pause, next, previous.`;
  }
  const repeat = key === 'up' || key === 'down' ? Math.max(1, Math.min(steps ?? 5, 20)) : 1;
  const script = `Add-Type -AssemblyName System.Windows.Forms; 1..${repeat} | ForEach-Object { [System.Windows.Forms.SendKeys]::SendWait([char]${code}) }`;
  try {
    await execAsync(`powershell -NoProfile -Command "${script}"`);
    return `Hecho: ${key}${repeat > 1 ? ` (x${repeat})` : ''}.`;
  } catch (err) {
    return `No pude ejecutar la accion de volumen: ${(err as Error).message}`;
  }
}

// --- Informacion del sistema (solo lectura) --------------------------------
export async function systemInfo(): Promise<string> {
  const totalGB = (os.totalmem() / 1024 ** 3).toFixed(1);
  const freeGB = (os.freemem() / 1024 ** 3).toFixed(1);

  let disco = 'No pude leer el disco.';
  let procesos = '';
  try {
    const script =
      '$disk = Get-PSDrive C; ' +
      '$procs = Get-Process | Sort-Object CPU -Descending | Select-Object -First 5 -Property Name,CPU; ' +
      '[PSCustomObject]@{ diskUsedGB = [math]::Round($disk.Used/1GB,1); diskFreeGB = [math]::Round($disk.Free/1GB,1); topProcesses = $procs } | ConvertTo-Json -Compress';
    const { stdout } = await execAsync(`powershell -NoProfile -Command "${script.replace(/"/g, '\\"')}"`);
    const data = JSON.parse(stdout);
    disco = `Disco C: ${data.diskUsedGB} GB usados, ${data.diskFreeGB} GB libres.`;
    const top = Array.isArray(data.topProcesses) ? data.topProcesses : [data.topProcesses];
    procesos =
      'Procesos que mas CPU acumulan ahora mismo: ' +
      top.map((p: { Name: string; CPU?: number }) => `${p.Name} (${Number(p.CPU ?? 0).toFixed(0)}s CPU)`).join(', ') +
      '.';
  } catch (err) {
    procesos = `No pude leer procesos: ${(err as Error).message}`;
  }

  return `RAM: ${freeGB} GB libres de ${totalGB} GB. ${disco} ${procesos}`;
}

// --- Archivos en carpetas concretas -----------------------------------------
// A proposito NO se permite navegar el disco libremente, solo estas 3.
const FOLDER_ALIASES: Record<string, string> = {
  descargas: path.join(os.homedir(), 'Downloads'),
  downloads: path.join(os.homedir(), 'Downloads'),
  escritorio: path.join(os.homedir(), 'Desktop'),
  desktop: path.join(os.homedir(), 'Desktop'),
  documentos: path.join(os.homedir(), 'Documents'),
  documents: path.join(os.homedir(), 'Documents'),
};

function resolveFolder(alias: string): string | null {
  return FOLDER_ALIASES[alias.trim().toLowerCase()] ?? null;
}

export async function listFiles(folder: string): Promise<string> {
  const root = resolveFolder(folder);
  if (!root) {
    return `Solo puedo ver estas carpetas: ${Object.keys(FOLDER_ALIASES).join(', ')}.`;
  }
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((e) => e.isFile())
        .map(async (e) => {
          const full = path.join(root, e.name);
          const s = await stat(full);
          return { name: e.name, mtime: s.mtimeMs };
        })
    );
    files.sort((a, b) => b.mtime - a.mtime);
    const top = files.slice(0, 15).map((f) => f.name);
    if (!top.length) return `La carpeta ${folder} esta vacia.`;
    return `Archivos en ${folder} (mas recientes primero): ${top.join(', ')}.`;
  } catch (err) {
    return `No pude leer ${folder}: ${(err as Error).message}`;
  }
}

export async function openPath(folder: string, filename?: string): Promise<string> {
  const root = resolveFolder(folder);
  if (!root) {
    return `Solo puedo abrir dentro de: ${Object.keys(FOLDER_ALIASES).join(', ')}.`;
  }
  const target = filename ? path.join(root, filename) : root;
  const resolvedTarget = path.resolve(target);
  const resolvedRoot = path.resolve(root);
  if (!resolvedTarget.startsWith(resolvedRoot)) {
    return 'Esa ruta se sale de la carpeta permitida, no la abro.';
  }
  try {
    await execAsync(`start "" "${resolvedTarget}"`);
    return `Abriendo ${filename ?? folder}.`;
  } catch (err) {
    return `No pude abrir eso: ${(err as Error).message}`;
  }
}
