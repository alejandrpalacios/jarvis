// Firebase (Auth/Firestore) no esta pensado para correr en el servidor.
// Esta app es un chat autenticado del lado del cliente: no hay nada que
// valga la pena pre-renderizar. Con esto SvelteKit genera un shell estatico
// y toda la logica (login, Firestore, etc.) corre solo en el navegador.
export const ssr = false;
export const prerender = true;
