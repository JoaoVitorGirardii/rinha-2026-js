import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const MODEL_PATH = process.env.MODEL_PATH
  ?? join(dirname(fileURLToPath(import.meta.url)), '../model.bin')
const buf = readFileSync(MODEL_PATH)

const headerN = buf.readUInt32LE(0)
const headerD = buf.readUInt32LE(4)
const headerC = buf.readUInt32LE(8)

// IVF se o model.bin tem cabeçalho de 12 bytes (C válido); legado tem 8 bytes
const IS_IVF = headerC > 0 && headerC < 100000

const N = headerN
const D = headerD
const C = IS_IVF ? headerC : 0

let centroids, assignments, features, labels, clusterIndices

if (IS_IVF) {
  let offset = 12
  centroids   = new Float32Array(buf.buffer, buf.byteOffset + offset, C * D); offset += C * D * 4
  assignments = new Uint32Array(buf.buffer,  buf.byteOffset + offset, N);     offset += N * 4
  features    = new Float32Array(buf.buffer, buf.byteOffset + offset, N * D); offset += N * D * 4
  labels      = new Uint8Array(buf.buffer,   buf.byteOffset + offset, N)

  const sizes = new Uint32Array(C)
  for (let i = 0; i < N; i++) sizes[assignments[i]]++

  clusterIndices = new Array(C)
  for (let c = 0; c < C; c++) clusterIndices[c] = new Int32Array(sizes[c])

  const ptrs = new Uint32Array(C)
  for (let i = 0; i < N; i++) {
    const c = assignments[i]
    clusterIndices[c][ptrs[c]++] = i
  }

  console.log(`IVF: ${N} pontos, ${C} clusters (avg ${Math.round(N / C)} pts/cluster)`)
} else {
  const featStart  = 8
  const labsStart  = featStart + N * D * 4
  features = new Float32Array(buf.buffer, buf.byteOffset + featStart, N * D)
  labels   = new Uint8Array(buf.buffer,   buf.byteOffset + labsStart, N)
  console.log(`KNN linear (legado): ${N} pontos`)
}

const K     = 5
const PROBE = 8   // PROBE=12 testado: p99 sobe +3ms sem ganho de precisão — 8 é o ótimo aqui

const _centDists = IS_IVF ? new Float32Array(C) : null
const _topDists  = new Float64Array(PROBE)
const _topC      = new Int32Array(PROBE)

export function knnScoreService(vector) {
  // === EARLY EXIT: regras determinísticas (66% do tráfego, 0 erros validados em 3M refs) ===
  // Obviamente legítima: merchant conhecido + valor baixo + perto de casa + baixo risco
  if (vector[11] === 0 && vector[2] < 0.15 && vector[7] < 0.05 && vector[12] <= 0.3 && vector[8] < 0.4 && vector[0] < 0.1) {
    return 0  // 0/5 votos → fraud_score=0.0, approved=true
  }
  // Obviamente fraude: merchant desconhecido + valor muito alto + alto risco + longe + frequente
  if (vector[11] === 1 && vector[2] > 0.8 && vector[12] >= 0.75 && vector[7] > 0.5 && vector[8] > 0.4) {
    return 5  // 5/5 votos → fraud_score=1.0, approved=false
  }

  let d0 = Infinity, d1 = Infinity, d2 = Infinity, d3 = Infinity, d4 = Infinity
  let l0 = 0, l1 = 0, l2 = 0, l3 = 0, l4 = 0

  if (IS_IVF) {
    for (let c = 0; c < C; c++) {
      let dist = 0
      const cBase = c * D
      for (let d = 0; d < D; d++) {
        const diff = centroids[cBase + d] - vector[d]
        dist += diff * diff
      }
      _centDists[c] = dist
    }

    _topDists.fill(Infinity)
    _topC.fill(-1)
    for (let c = 0; c < C; c++) {
      const dist = _centDists[c]
      if (dist < _topDists[PROBE - 1]) {
        _topDists[PROBE - 1] = dist
        _topC[PROBE - 1] = c
        for (let k = PROBE - 1; k > 0 && _topDists[k] < _topDists[k - 1]; k--) {
          const t = _topDists[k]; _topDists[k] = _topDists[k - 1]; _topDists[k - 1] = t
          const tc = _topC[k];    _topC[k] = _topC[k - 1];         _topC[k - 1] = tc
        }
      }
    }

    for (let k = 0; k < PROBE; k++) {
      const c = _topC[k]
      if (c < 0) continue
      const idx = clusterIndices[c]
      const len = idx.length
      for (let ki = 0; ki < len; ki++) {
        const i = idx[ki]
        const base = i * D
        let sum = 0
        for (let d = 0; d < D; d++) {
          const diff = features[base + d] - vector[d]
          sum += diff * diff
        }
        const label = labels[i]
        if (sum < d0)      { d4=d3; l4=l3; d3=d2; l3=l2; d2=d1; l2=l1; d1=d0; l1=l0; d0=sum; l0=label }
        else if (sum < d1) { d4=d3; l4=l3; d3=d2; l3=l2; d2=d1; l2=l1; d1=sum; l1=label }
        else if (sum < d2) { d4=d3; l4=l3; d3=d2; l3=l2; d2=sum; l2=label }
        else if (sum < d3) { d4=d3; l4=l3; d3=sum; l3=label }
        else if (sum < d4) { d4=sum; l4=label }
      }
    }
  } else {
    for (let i = 0; i < N; i++) {
      const base = i * D
      let sum = 0
      for (let d = 0; d < D; d++) {
        const diff = features[base + d] - vector[d]
        sum += diff * diff
      }
      const label = labels[i]
      if (sum < d0)      { d4=d3; l4=l3; d3=d2; l3=l2; d2=d1; l2=l1; d1=d0; l1=l0; d0=sum; l0=label }
      else if (sum < d1) { d4=d3; l4=l3; d3=d2; l3=l2; d2=d1; l2=l1; d1=sum; l1=label }
      else if (sum < d2) { d4=d3; l4=l3; d3=d2; l3=l2; d2=sum; l2=label }
      else if (sum < d3) { d4=d3; l4=l3; d3=sum; l3=label }
      else if (sum < d4) { d4=sum; l4=label }
    }
  }

  return l0 + l1 + l2 + l3 + l4  // votos de fraude (0-5); server mapeia para resposta pré-computada
}
