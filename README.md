# Jarvis

Asistente personal propio: cerebro en la nube (gratis), sincronizado en tiempo real entre PC y móvil, con personalidad tipo Jarvis (cercano, ingenioso, un poco sarcástico).

## Arquitectura (Fase 1)

```
   TÚ (chat, por ahora)
        │
        ▼
  ┌───────────┐         ┌──────────────────────┐
  │  Web PWA  │ ──────► │  Firestore (Google)  │ ◄────── conexión SALIENTE
  │(PC / Pixel)│         │  mensajes · memoria  │         desde tu PC, nunca
  └───────────┘         └──────────┬───────────┘         al revés
        ▲                          ▲
        │                          │ escucha mensajes nuevos
  ┌─────┴───────┐                  │
  │   Brain     │ ─────────────────┘
  │ (Node, tuya │   llama a Groq (LLM gratis)
  │  o en la    │
  │  nube)      │
  └─────────────┘
```

- **Cero puertos abiertos, cero cambios en tu router.** Todo son conexiones salientes hacia Firestore/Groq.
- El **brain** es el único que tiene la clave de Groq y la cuenta de servicio de Firebase — nunca viven en el navegador.
- La **web** es una PWA: se instala tanto en el Pixel ("Añadir a pantalla de inicio") como en el PC, y ambas ven la misma conversación al segundo.

## Qué funciona ya / qué falta

| Fase | Estado |
|---|---|
| 1 — Chat con personalidad, memoria, sync PC↔Pixel | ✅ Este commit |
| 2 — Voz (wake word, STT, TTS) | ⏳ Pendiente |
| 3 — Control del PC (agente local, Wake-on-LAN) | ⏳ Pendiente — esperando reparación (pasta térmica) |
| 4 — Búsqueda web + recordatorios/automatizaciones | ⏳ Pendiente |
| 5 — Control del Pixel | ⏳ Pendiente |

El agente de control de PC (Fase 3) usará un "ayudante" siempre encendido en la LAN (el móvil Android viejo, o un ESP32/Raspberry Pi si no aguanta) para poder encender el PC por Wake-on-LAN incluso estando fuera de casa, sin abrir nada en el router Livebox.

## Estructura del repo

```
packages/
├── shared/   tipos, colecciones de Firestore, prompt de personalidad
├── brain/    orquestador Node: escucha Firestore, llama a Groq, ejecuta herramientas
└── web/      PWA SvelteKit: chat, login con Google, instalable en PC y Pixel
```

## Puesta en marcha

### 1. Firebase

1. Crea un proyecto en [console.firebase.google.com](https://console.firebase.google.com).
2. **Firestore Database** → crear base de datos (modo producción).
3. **Authentication** → Sign-in method → habilita **Google**.
4. En **Firestore → Reglas**, pega el contenido de [`firestore.rules`](firestore.rules) (ya está listo para permitir solo tu cuenta — cambia el email dentro si hace falta).
5. **Configuración del proyecto → Tus apps → Web** (ícono `</>`) → registra una app → copia los valores del `firebaseConfig` a `packages/web/.env` (usa `.env.example` como guía).
6. **Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada** → descarga el JSON → guárdalo como `packages/brain/service-account.json` (ya está en `.gitignore`, nunca se sube).

### 2. Groq (el cerebro)

1. Crea cuenta gratis en [console.groq.com](https://console.groq.com) → genera una API key.
2. Copia `packages/brain/.env.example` a `packages/brain/.env` y pega tu key en `GROQ_API_KEY`.

### 3. Instalar y correr

```bash
npm install

# Terminal 1 — el cerebro
npm run dev:brain

# Terminal 2 — la app
npm run dev:web
```

Abre la URL que te dé `dev:web` (normalmente `http://localhost:5173`), entra con tu cuenta de Google (la misma que pusiste en `firestore.rules`), y ya puedes hablar con Jarvis. Abre la misma URL desde el Pixel (misma red o desplegado en Vercel) y verás la conversación sincronizada al instante.

### 4. Instalar como app en el Pixel

Con la web abierta en Chrome del Pixel: menú (⋮) → **Añadir a pantalla de inicio**. Los íconos son un placeholder SVG; si quieres mejor calidad de instalación más adelante, añade `static/icon-192.png` y `static/icon-512.png` reales y súmalos al `manifest.webmanifest`.

## Notas de seguridad

- El brain nunca escucha conexiones entrantes: solo lee/escribe en Firestore hacia afuera. No hay nada que atacar desde internet.
- `service-account.json` y los `.env` están en `.gitignore` — revisa antes de hacer commit si alguna vez los tocas a mano.
- Las reglas de Firestore restringen todo a un único email. Si quieres agregar más gente, hay que rediseñar las reglas primero.
