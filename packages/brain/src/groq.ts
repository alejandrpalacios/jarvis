import Groq from 'groq-sdk';

const apiKey = process.env.GROQ_API_KEY;
if (!apiKey) {
  throw new Error(
    'Falta GROQ_API_KEY en packages/brain/.env. Consiguela gratis en https://console.groq.com'
  );
}

export const groq = new Groq({ apiKey });
export const GROQ_MODEL = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile';
