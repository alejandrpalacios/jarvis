/** Arma un WAV PCM de 16 bits, mono, a partir de frames Int16. Sin
 * dependencias externas -- es solo un header de 44 bytes + los datos. */
export function framesToWav(frames: Int16Array[], sampleRate: number): Buffer {
  const totalSamples = frames.reduce((sum, f) => sum + f.length, 0);
  const dataSize = totalSamples * 2; // 16 bits = 2 bytes por muestra
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // tamano del bloque fmt (PCM)
  buffer.writeUInt16LE(1, 20); // formato PCM
  buffer.writeUInt16LE(1, 22); // 1 canal (mono)
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits por muestra
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  let offset = 44;
  for (const frame of frames) {
    for (let i = 0; i < frame.length; i++) {
      buffer.writeInt16LE(frame[i]!, offset);
      offset += 2;
    }
  }
  return buffer;
}
