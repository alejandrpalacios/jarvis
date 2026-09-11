<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
  import { auth, googleProvider } from '$lib/firebase';
  import { messages, subscribeToChat, sendMessage } from '$lib/stores/chat';
  import { isVoiceSupported, listenOnce, speak, stopSpeaking } from '$lib/voice';

  let user: User | null = null;
  let authReady = false;
  let draft = '';
  let listEl: HTMLDivElement;
  let sending = false;
  let unsub: (() => void) | undefined;

  let voiceSupported = false;
  let listening = false;
  let autoSpeak = true;
  let lastSeenMessageId: string | null = null;
  let sawInitialMessages = false;

  onMount(() => {
    voiceSupported = isVoiceSupported();
    try {
      autoSpeak = localStorage.getItem('jarvis:autoSpeak') !== 'off';
    } catch {
      // Almacenamiento bloqueado (privado, permisos, etc.): nos quedamos con el default.
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
      if (last.role === 'assistant' && autoSpeak) {
        speak(last.content);
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
    if (!autoSpeak) stopSpeaking();
  }

  async function handleMic() {
    if (!voiceSupported || listening) return;
    listening = true;
    try {
      const transcript = await listenOnce();
      if (transcript) {
        await sendMessage(transcript);
      }
    } catch (err) {
      console.error('[voz]', err);
    } finally {
      listening = false;
    }
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
  {:else}
    <header>
      <div class="brand">
        <span class="dot"></span>
        Jarvis
      </div>
      <div class="header-actions">
        {#if voiceSupported}
          <button class="ghost icon" on:click={toggleAutoSpeak} title={autoSpeak ? 'Silenciar respuestas' : 'Activar voz'}>
            {autoSpeak ? '🔊' : '🔇'}
          </button>
        {/if}
        <button class="ghost" on:click={logout}>Salir</button>
      </div>
    </header>

    <div class="messages" bind:this={listEl}>
      {#if $messages.length === 0}
        <p class="empty">Aun no hay nada por aqui. Escribeme algo.</p>
      {/if}
      {#each $messages as m (m.id)}
        <div class="bubble {m.role}">
          <p>{m.content}</p>
        </div>
      {/each}
    </div>

    <form on:submit|preventDefault={handleSubmit}>
      {#if voiceSupported}
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
    background: #05070d;
    color: #e8f4ff;
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
    background: radial-gradient(circle, #4fd1ff 0%, #0e2f44 60%, transparent 70%);
    box-shadow: 0 0 30px rgba(79, 209, 255, 0.5);
  }

  h1 {
    margin: 0 0 0.25rem;
    letter-spacing: 0.08em;
  }

  p {
    color: #9db4c9;
  }

  button {
    background: #4fd1ff;
    color: #05070d;
    border: none;
    border-radius: 999px;
    padding: 0.6rem 1.4rem;
    font-weight: 600;
    cursor: pointer;
  }

  button.ghost {
    background: transparent;
    color: #9db4c9;
    border: 1px solid #223244;
    padding: 0.4rem 1rem;
  }

  button.ghost.icon {
    padding: 0.4rem 0.6rem;
    font-size: 1rem;
    line-height: 1;
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
    border: 1px solid #223244;
    background: #0b0f16;
    font-size: 1.1rem;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }

  .mic.listening {
    background: #12374a;
    border-color: #4fd1ff;
    box-shadow: 0 0 12px rgba(79, 209, 255, 0.5);
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
    border-bottom: 1px solid #131c28;
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
    background: #4fd1ff;
    box-shadow: 0 0 8px #4fd1ff;
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
    color: #56697c;
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
    background: #12374a;
    color: #eaf7ff;
    border-bottom-right-radius: 4px;
  }

  .bubble.assistant {
    align-self: flex-start;
    background: #11151d;
    border: 1px solid #1c2531;
    border-bottom-left-radius: 4px;
  }

  form {
    display: flex;
    gap: 0.6rem;
    padding: 0.8rem 1.2rem calc(0.8rem + env(safe-area-inset-bottom));
    border-top: 1px solid #131c28;
    flex-shrink: 0;
  }

  input {
    flex: 1;
    background: #0b0f16;
    border: 1px solid #1c2531;
    border-radius: 999px;
    padding: 0.6rem 1rem;
    color: #e8f4ff;
    font-size: 1rem;
  }

  input:focus {
    outline: none;
    border-color: #4fd1ff;
  }
</style>
