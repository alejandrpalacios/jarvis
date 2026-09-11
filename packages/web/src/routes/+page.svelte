<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
  import { auth, googleProvider } from '$lib/firebase';
  import { messages, subscribeToChat, sendMessage, startNewSession } from '$lib/stores/chat';
  import {
    isVoiceSupported,
    listenOnce,
    speak,
    stopSpeaking,
    startWakeWordMode,
    stopWakeWordMode,
  } from '$lib/voice';

  // Frases de control que no se mandan a Jarvis como pregunta: cambian la
  // interfaz directamente, al toque, sin esperar ninguna respuesta del cerebro.
  const OPEN_CHAT_PATTERN = /activa (el )?modo chat|abre (el )?chat|muestra (el )?chat/i;
  const CLOSE_CHAT_PATTERN = /cierra (el )?modo chat|cierra (el )?chat|oculta (el )?chat/i;
  const NEW_CHAT_PATTERN = /nueva conversaci[oó]n|empecemos de cero|borra (el )?chat/i;

  type OrbState = 'idle' | 'listening' | 'awake' | 'thinking' | 'speaking';

  let user: User | null = null;
  let authReady = false;
  let draft = '';
  let listEl: HTMLDivElement;
  let sending = false;
  let unsub: (() => void) | undefined;

  let voiceSupported = false;
  let listening = false;
  let autoSpeak = true;
  let handsFree = false;
  let awaitingCommand = false;
  let thinking = false;
  let speaking = false;
  let chatVisible = false;
  let lastSeenMessageId: string | null = null;
  let sawInitialMessages = false;

  $: orbState = (speaking
    ? 'speaking'
    : thinking
      ? 'thinking'
      : awaitingCommand
        ? 'awake'
        : handsFree
          ? 'listening'
          : 'idle') as OrbState;

  $: statusText =
    orbState === 'speaking'
      ? 'Hablando...'
      : orbState === 'thinking'
        ? 'Pensando...'
        : orbState === 'awake'
          ? 'Dime...'
          : orbState === 'listening'
            ? 'Diga "Jarvis" para hablarme'
            : voiceSupported
              ? 'Toque el nucleo o diga "Jarvis"'
              : 'Toque el nucleo para escribirme';

  onMount(() => {
    voiceSupported = isVoiceSupported();
    try {
      autoSpeak = localStorage.getItem('jarvis:autoSpeak') !== 'off';
    } catch {
      // Almacenamiento bloqueado (privado, permisos, etc.): nos quedamos con el default.
    }

    let wantedHandsFree = false;
    try {
      wantedHandsFree = localStorage.getItem('jarvis:handsFree') === 'on';
    } catch {
      // Sin almacenamiento persistente: arranca apagado, como el default.
    }
    if (wantedHandsFree && voiceSupported) {
      // Intento silencioso: si el permiso de microfono ya se dio antes,
      // esto arranca solo. Si no, el usuario solo tiene que tocar el boton.
      enableHandsFree();
    }

    const stop = onAuthStateChanged(auth, (u) => {
      user = u;
      authReady = true;
      if (u) unsub = subscribeToChat();
    });
    return stop;
  });

  onDestroy(() => {
    unsub?.();
    stopSpeaking();
    stopWakeWordMode();
  });

  $: if ($messages.length) {
    tick().then(() => {
      listEl?.scrollTo({ top: listEl.scrollHeight, behavior: 'smooth' });
    });

    const last = $messages[$messages.length - 1];
    if (!sawInitialMessages) {
      // No leemos en voz alta el historial que ya existia al cargar la pagina.
      lastSeenMessageId = last.id;
      sawInitialMessages = true;
    } else if (last.id !== lastSeenMessageId) {
      lastSeenMessageId = last.id;
      if (last.role === 'assistant') {
        thinking = false;
        if (autoSpeak) {
          speaking = true;
          speak(last.content, () => {
            speaking = false;
          });
        }
      }
    }
  }

  function toggleAutoSpeak() {
    autoSpeak = !autoSpeak;
    try {
      localStorage.setItem('jarvis:autoSpeak', autoSpeak ? 'on' : 'off');
    } catch {
      // Sin almacenamiento persistente: el toggle sigue funcionando solo en esta sesion.
    }
    if (!autoSpeak) {
      stopSpeaking();
      speaking = false;
    }
  }

  async function handleMic() {
    if (!voiceSupported || listening || handsFree) return;
    listening = true;
    try {
      const transcript = await listenOnce();
      if (transcript) {
        thinking = true;
        await sendMessage(transcript);
      }
    } catch (err) {
      console.error('[voz]', err);
    } finally {
      listening = false;
    }
  }

  function enableHandsFree() {
    const ok = startWakeWordMode({
      onWake: () => {
        awaitingCommand = true;
        speak('Dime.');
      },
      onCommand: (text) => {
        awaitingCommand = false;
        const normalized = text.trim();

        if (OPEN_CHAT_PATTERN.test(normalized)) {
          chatVisible = true;
          return;
        }
        if (CLOSE_CHAT_PATTERN.test(normalized)) {
          chatVisible = false;
          return;
        }
        if (NEW_CHAT_PATTERN.test(normalized)) {
          void startNewSession();
          chatVisible = false;
          return;
        }

        thinking = true;
        void sendMessage(normalized);
      },
      onError: (message) => {
        console.error('[manos libres]', message);
        handsFree = false;
        awaitingCommand = false;
      },
    });
    handsFree = ok;
    try {
      localStorage.setItem('jarvis:handsFree', ok ? 'on' : 'off');
    } catch {
      // Sin almacenamiento persistente: el modo sigue funcionando en esta sesion.
    }
  }

  function toggleHandsFree() {
    if (handsFree) {
      stopWakeWordMode();
      handsFree = false;
      awaitingCommand = false;
      try {
        localStorage.setItem('jarvis:handsFree', 'off');
      } catch {
        // ver nota de arriba
      }
    } else {
      enableHandsFree();
    }
  }

  function openChat() {
    chatVisible = true;
  }

  function closeChat() {
    chatVisible = false;
  }

  async function newChat() {
    await startNewSession();
  }

  async function login() {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error(err);
      alert('No se pudo iniciar sesion. Revisa la consola.');
    }
  }

  async function logout() {
    await signOut(auth);
  }

  async function handleSubmit() {
    if (!draft.trim() || sending) return;
    const text = draft;
    draft = '';
    sending = true;
    thinking = true;
    try {
      await sendMessage(text);
    } finally {
      sending = false;
    }
  }
</script>

<svelte:head>
  <title>Jarvis</title>
</svelte:head>

<main>
  {#if !authReady}
    <div class="center">Arrancando...</div>
  {:else if !user}
    <div class="center">
      <div class="login-card">
        <div class="reactor"></div>
        <h1>Jarvis</h1>
        <p>Inicia sesion para hablar conmigo.</p>
        <button on:click={login}>Conectar con Google</button>
      </div>
    </div>
  {:else if !chatVisible}
    <div class="orb-view">
      <button class="orb-button" on:click={openChat} title="Abrir modo chat">
        <div class="orb {orbState}"></div>
      </button>
      <p class="orb-status">{statusText}</p>

      <div class="orb-toolbar">
        {#if voiceSupported}
          <button
            class="ghost icon {handsFree ? 'active' : ''}"
            on:click={toggleHandsFree}
            title={handsFree ? 'Apagar manos libres' : 'Manos libres: di "Jarvis" para hablarme'}
          >
            🎙️
          </button>
          <button class="ghost icon" on:click={toggleAutoSpeak} title={autoSpeak ? 'Silenciar respuestas' : 'Activar voz'}>
            {autoSpeak ? '🔊' : '🔇'}
          </button>
        {/if}
        <button class="ghost icon" on:click={openChat} title="Escribirle a Jarvis">⌨️</button>
        <button class="ghost" on:click={logout}>Salir</button>
      </div>
    </div>
  {:else}
    <header>
      <div class="brand">
        <button class="ghost icon back" on:click={closeChat} title="Volver al nucleo">⟵</button>
        <span class="dot"></span>
        Jarvis
      </div>
      <div class="header-actions">
        {#if voiceSupported}
          <button
            class="ghost icon {handsFree ? 'active' : ''}"
            on:click={toggleHandsFree}
            title={handsFree ? 'Apagar manos libres' : 'Manos libres: di "Jarvis" para hablarme'}
          >
            🎙️
          </button>
          <button class="ghost icon" on:click={toggleAutoSpeak} title={autoSpeak ? 'Silenciar respuestas' : 'Activar voz'}>
            {autoSpeak ? '🔊' : '🔇'}
          </button>
        {/if}
        <button class="ghost icon" on:click={newChat} title="Nueva conversacion (empieza sin arrastrar el contexto anterior)">
          🗑️
        </button>
        <button class="ghost" on:click={logout}>Salir</button>
      </div>
    </header>

    {#if handsFree}
      <p class="hands-free-banner">
        <span class="rec-dot"></span>
        {awaitingCommand ? 'Dime...' : 'Modo manos libres activo -- di "Jarvis" para hablarme'}
      </p>
    {/if}

    <div class="messages" bind:this={listEl}>
      {#if $messages.length === 0}
        <p class="empty">Aun no hay nada por aqui. Escribeme algo.</p>
      {/if}
      {#each $messages as m (m.id)}
        <div class="bubble {m.role}">
          <p>{m.content}</p>
        </div>
      {/each}
      {#if thinking}
        <div class="bubble assistant thinking-bubble">
          <span class="think-dot"></span><span class="think-dot"></span><span class="think-dot"></span>
        </div>
      {/if}
    </div>

    <form on:submit|preventDefault={handleSubmit}>
      {#if voiceSupported && !handsFree}
        <button
          type="button"
          class="mic {listening ? 'listening' : ''}"
          on:click={handleMic}
          disabled={sending}
          title="Hablarle a Jarvis"
        >
          {listening ? '🎙️' : '🎤'}
        </button>
      {/if}
      <input
        type="text"
        placeholder={listening ? 'Escuchando...' : 'Escribele a Jarvis...'}
        bind:value={draft}
        disabled={sending || listening}
      />
      <button type="submit" disabled={sending || listening || !draft.trim()}>Enviar</button>
    </form>
  {/if}
</main>

<style>
  :global(html, body) {
    margin: 0;
    height: 100%;
    background: #0a0704;
    color: #ffe9d6;
    font-family:
      'Segoe UI',
      system-ui,
      sans-serif;
  }

  main {
    height: 100dvh;
    display: flex;
    flex-direction: column;
  }

  .center {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
  }

  .login-card {
    text-align: center;
    max-width: 320px;
  }

  .reactor {
    width: 72px;
    height: 72px;
    margin: 0 auto 1rem;
    border-radius: 50%;
    background: radial-gradient(circle, #ffd9a0 0%, #ff8a34 40%, #401d00 70%, transparent 75%);
    box-shadow: 0 0 30px rgba(255, 138, 52, 0.5);
  }

  h1 {
    margin: 0 0 0.25rem;
    letter-spacing: 0.08em;
  }

  p {
    color: #c9a888;
  }

  button {
    background: #ff8a34;
    color: #170b00;
    border: none;
    border-radius: 999px;
    padding: 0.6rem 1.4rem;
    font-weight: 600;
    cursor: pointer;
  }

  button.ghost {
    background: transparent;
    color: #c9a888;
    border: 1px solid #3a2413;
    padding: 0.4rem 1rem;
  }

  button.ghost.icon {
    padding: 0.4rem 0.6rem;
    font-size: 1rem;
    line-height: 1;
  }

  button.ghost.icon.active {
    background: #3a2410;
    border-color: #ff8a34;
  }

  button.ghost.icon.back {
    border: none;
    padding: 0.2rem 0.4rem;
    font-size: 1.1rem;
  }

  .hands-free-banner {
    margin: 0;
    padding: 0.5rem 1.2rem;
    background: #201005;
    border-bottom: 1px solid #3a2413;
    color: #ffb877;
    font-size: 0.85rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
  }

  .rec-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #ff5f5f;
    box-shadow: 0 0 6px #ff5f5f;
    animation: pulse 1.2s ease-in-out infinite;
    flex-shrink: 0;
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .mic {
    flex-shrink: 0;
    width: 2.6rem;
    height: 2.6rem;
    border-radius: 50%;
    border: 1px solid #3a2413;
    background: #170e07;
    font-size: 1.1rem;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }

  .mic.listening {
    background: #3a2410;
    border-color: #ff8a34;
    box-shadow: 0 0 12px rgba(255, 138, 52, 0.5);
    animation: pulse 1.2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.08);
    }
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.9rem 1.2rem;
    border-bottom: 1px solid #201304;
    flex-shrink: 0;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 600;
    letter-spacing: 0.05em;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #ff8a34;
    box-shadow: 0 0 8px #ff8a34;
  }

  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 1rem 1.2rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .empty {
    margin: auto;
    color: #5c4630;
  }

  .bubble {
    max-width: 78%;
    padding: 0.55rem 0.85rem;
    border-radius: 14px;
    line-height: 1.4;
  }

  .bubble p {
    margin: 0;
    color: inherit;
    white-space: pre-wrap;
  }

  .bubble.user {
    align-self: flex-end;
    background: #3a2410;
    color: #ffe9d6;
    border-bottom-right-radius: 4px;
  }

  .bubble.assistant {
    align-self: flex-start;
    background: #150f09;
    border: 1px solid #241708;
    border-bottom-left-radius: 4px;
  }

  .thinking-bubble {
    display: flex;
    gap: 0.3rem;
    padding: 0.7rem 0.9rem;
  }

  .think-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #ff8a34;
    opacity: 0.5;
    animation: thinkBounce 1.2s ease-in-out infinite;
  }

  .think-dot:nth-child(2) {
    animation-delay: 0.2s;
  }

  .think-dot:nth-child(3) {
    animation-delay: 0.4s;
  }

  @keyframes thinkBounce {
    0%,
    100% {
      opacity: 0.35;
      transform: translateY(0);
    }
    50% {
      opacity: 1;
      transform: translateY(-3px);
    }
  }

  form {
    display: flex;
    gap: 0.6rem;
    padding: 0.8rem 1.2rem calc(0.8rem + env(safe-area-inset-bottom));
    border-top: 1px solid #201304;
    flex-shrink: 0;
  }

  input {
    flex: 1;
    background: #170e07;
    border: 1px solid #241708;
    border-radius: 999px;
    padding: 0.6rem 1rem;
    color: #ffe9d6;
    font-size: 1rem;
  }

  input:focus {
    outline: none;
    border-color: #ff8a34;
  }

  /* --- Vista "nucleo" (bolita), la pantalla por defecto ------------------ */

  .orb-view {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1.4rem;
    padding: 1.5rem;
  }

  .orb-button {
    background: none;
    border: none;
    padding: 2rem;
    cursor: pointer;
  }

  .orb {
    --size: min(46vw, 220px);
    width: var(--size);
    height: var(--size);
    border-radius: 50%;
    position: relative;
    background: radial-gradient(circle at 50% 42%, #ffe3bb 0%, #ff8a34 38%, #6a2c00 72%, transparent 100%);
    box-shadow: 0 0 70px 12px rgba(255, 138, 52, 0.45);
    animation: breathe 4.5s ease-in-out infinite;
    transition: box-shadow 0.3s ease;
  }

  .orb::before,
  .orb::after {
    content: '';
    position: absolute;
    inset: -16px;
    border-radius: 50%;
    border: 2px solid transparent;
    border-top-color: rgba(255, 168, 92, 0.8);
    border-right-color: rgba(255, 168, 92, 0.2);
    animation: spin 7s linear infinite;
  }

  .orb::after {
    inset: -32px;
    border-top-color: rgba(255, 202, 143, 0.45);
    animation: spin 11s linear infinite reverse;
  }

  .orb.listening {
    animation: breathe 2.8s ease-in-out infinite;
  }

  .orb.awake {
    animation: pulseFast 0.9s ease-in-out infinite;
    box-shadow: 0 0 100px 18px rgba(255, 138, 52, 0.6);
  }

  .orb.thinking::before {
    animation-duration: 1.1s;
  }

  .orb.thinking::after {
    animation-duration: 1.7s;
  }

  .orb.speaking {
    animation: speakPulse 0.55s ease-in-out infinite;
    box-shadow: 0 0 90px 16px rgba(255, 154, 68, 0.6);
  }

  .orb-status {
    margin: 0;
    color: #c9a888;
    font-size: 0.95rem;
    letter-spacing: 0.02em;
  }

  .orb-toolbar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  @keyframes breathe {
    0%,
    100% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.05);
    }
  }

  @keyframes pulseFast {
    0%,
    100% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.12);
    }
  }

  @keyframes speakPulse {
    0%,
    100% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.07);
    }
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
</style>
