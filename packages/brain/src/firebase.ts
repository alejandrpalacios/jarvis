import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';

const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS ?? './service-account.json';

function loadServiceAccount() {
  try {
    const raw = readFileSync(serviceAccountPath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `No pude leer la credencial de Firebase en "${serviceAccountPath}". ` +
        'Generala en Firebase console > Configuracion del proyecto > Cuentas de servicio, ' +
        `guardala ahi o apunta GOOGLE_APPLICATION_CREDENTIALS a su ruta. Detalle: ${(err as Error).message}`
    );
  }
}

// El Admin SDK ignora firestore.rules por completo: este proceso es el
// backend de confianza, por eso vive solo en tu maquina/servidor, nunca en
// el navegador ni en el movil.
if (!getApps().length) {
  initializeApp({ credential: cert(loadServiceAccount()) });
}

export const db = getFirestore();
