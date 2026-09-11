<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
  import { auth, googleProvider } from '$lib/firebase';
  import { messages, subscribeToChat, sendMessage } from '$lib/stores/chat';

  let user: User | null = null;
  let authReady = false;
  let draft = '';
  let listEl: HTMLDivElement;
  let sending = false;
  let unsub: (() => void) | undefined;

  onMount(() => {
    const stop = onAuthStateChanged(auth, (u) => {
      user = u;
      authReady = true;
      if (u) unsub = subscribeToChat();
    });
    return stop;
  });

  onDestroy(() => {
    unsub?.();
  });

  $: if ($messages.length) {
    tick().then(() => {
      listEl?.scrollTo({ top: listEl.scrollHeight, behavior: 'smooth' });
    });
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
      <button class="ghost" on:click={logout}>Salir</button>
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
      <input type="text" placeholder="Escribele a Jarvis..." bind:value={draft} disabled={sending} />
      <button type="submit" disabled={sending || !draft.trim()}>Enviar</button>
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

  button:disabled {
    opacity: 0.5;
    cursor: default;
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
