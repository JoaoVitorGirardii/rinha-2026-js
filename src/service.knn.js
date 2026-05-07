import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const buf = readFileSync(join(__dirname, '../model.bin'));

const N = buf.readUInt32LE(0);
const D = buf.readUInt32LE(4);
const featuresStart = 8;
const labelsStart = featuresStart + N * D * 4;

// Views zero-copy sobre o Buffer lido do disco (sem cópia de memória)
const features = new Float32Array(buf.buffer, buf.byteOffset + featuresStart, N * D);
const labels = new Uint8Array(buf.buffer, buf.byteOffset + labelsStart, N);

console.log(`KNN pronto: ${N} pontos de treino carregados.`);

const K = 5;

export function knnScoreService(vector) {
  let d0 = Infinity, d1 = Infinity, d2 = Infinity;
  let l0 = 0, l1 = 0, l2 = 0;

  for (let i = 0; i < N; i++) {
    const base = i * D;
    let sum = 0;
    for (let j = 0; j < D; j++) {
      const diff = features[base + j] - vector[j];
      sum += diff * diff;
    }
    const label = labels[i];
    if (sum < d0)      { d2=d1; l2=l1; d1=d0; l1=l0; d0=sum; l0=label; }
    else if (sum < d1) { d2=d1; l2=l1; d1=sum; l1=label; }
    else if (sum < d2) { d2=sum; l2=label; }
  }

  const fraud_score = parseFloat(((l0 + l1 + l2) / K).toFixed(4));
  const approved = fraud_score < 0.5;
  return { fraud_score, approved };
}
