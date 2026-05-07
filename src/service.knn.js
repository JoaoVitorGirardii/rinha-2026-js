import KNN from 'ml-knn';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const modelData = JSON.parse(readFileSync(join(__dirname, '../model.json'), 'utf-8'));
const knn = KNN.load(modelData);

// Extrai os pontos de treino da KD-tree e armazena em typed arrays contíguos
// Float64Array → SIMD-friendly, muito mais rápido que percorrer ponteiros da árvore
const D = 14;
const rawPoints = [];
function collectNodes(node) {
  if (!node || !node.obj) return;
  rawPoints.push(node.obj);
  collectNodes(node.left);
  collectNodes(node.right);
}
collectNodes(knn.kdTree.root);

const N = rawPoints.length;
const features = new Float64Array(N * D);
const labels = new Uint8Array(N); // 1 = fraud, 0 = legit

for (let i = 0; i < N; i++) {
  const p = rawPoints[i];
  for (let j = 0; j < D; j++) features[i * D + j] = p[j];
  labels[i] = p[D] === 'fraud' ? 1 : 0;
}

console.log(`KNN pronto: ${N} pontos de treino carregados.`);

const K = 3;

export function knnScoreService(vector) {
  // Linear scan top-K: mais rápido que KD-tree para N pequeno em alta dimensão
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
