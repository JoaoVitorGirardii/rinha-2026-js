import { readFileSync, writeFileSync } from 'node:fs'

const MAX_SAMPLES = 600000
const C = 1200       // clusters IVF (escala proporcional a N: mantém ~500pts/cluster)
const KMEANS_ITER = 25
const D = 14

console.time('Total')
console.log('Lendo references.json...')
const refs = JSON.parse(readFileSync('./references.json', 'utf-8'))
console.log(`${refs.length} vetores carregados.`)

const fraudRefs = refs.filter(r => r.label === 'fraud')
const legitRefs = refs.filter(r => r.label === 'legit')
console.log(`Fraudes: ${fraudRefs.length}, Legítimas: ${legitRefs.length}`)

function sampleEvenly(arr, n) {
  if (n >= arr.length) return arr
  const step = arr.length / n
  const result = new Array(n)
  for (let i = 0; i < n; i++) result[i] = arr[Math.floor(i * step)]
  return result
}

const fraudRatio = fraudRefs.length / refs.length
const fraudTarget = Math.min(fraudRefs.length, Math.max(Math.floor(MAX_SAMPLES * 0.35), Math.floor(fraudRatio * MAX_SAMPLES)))
const legitTarget = Math.min(legitRefs.length, MAX_SAMPLES - fraudTarget)

const sampledFraud = sampleEvenly(fraudRefs, fraudTarget)
const sampledLegit = sampleEvenly(legitRefs, legitTarget)

const sampled = []
const maxLen = Math.max(sampledFraud.length, sampledLegit.length)
for (let i = 0; i < maxLen; i++) {
  if (i < sampledFraud.length) sampled.push(sampledFraud[i])
  if (i < sampledLegit.length) sampled.push(sampledLegit[i])
}

const N = sampled.length
console.log(`Usando ${N} amostras (${sampledFraud.length} fraudes, ${sampledLegit.length} legítimas)`)

const features = new Float32Array(N * D)
const labels = new Uint8Array(N)

for (let i = 0; i < N; i++) {
  const r = sampled[i]
  for (let j = 0; j < D; j++) features[i * D + j] = r.vector[j]
  labels[i] = r.label === 'fraud' ? 1 : 0
}

// K-Means++ para gerar C centroides IVF
console.log(`\nExecutando k-means++ com C=${C}, maxIter=${KMEANS_ITER}...`)
console.time('K-means')

const centroids = new Float32Array(C * D)

// Inicialização k-means++: cada novo centroide é escolhido com prob. proporcional a dist² ao mais próximo
const minDists = new Float64Array(N).fill(Infinity)
const firstIdx = Math.floor(Math.random() * N)
for (let d = 0; d < D; d++) centroids[d] = features[firstIdx * D + d]

for (let c = 1; c < C; c++) {
  const prevBase = (c - 1) * D
  let totalDist = 0
  for (let i = 0; i < N; i++) {
    let dist = 0
    const iBase = i * D
    for (let d = 0; d < D; d++) {
      const diff = features[iBase + d] - centroids[prevBase + d]
      dist += diff * diff
    }
    if (dist < minDists[i]) minDists[i] = dist
    totalDist += minDists[i]
  }
  let r = Math.random() * totalDist
  let chosen = N - 1
  for (let i = 0; i < N; i++) {
    r -= minDists[i]
    if (r <= 0) { chosen = i; break }
  }
  const cBase = c * D
  const chosenBase = chosen * D
  for (let d = 0; d < D; d++) centroids[cBase + d] = features[chosenBase + d]
  if (c % 100 === 0) process.stdout.write(`\r  Init k-means++: ${c}/${C}`)
}
console.log(`\r  Init k-means++: ${C}/${C} - concluído`)

// Iterações k-means
const assignments = new Uint32Array(N)
const counts = new Uint32Array(C)

for (let iter = 0; iter < KMEANS_ITER; iter++) {
  let changed = 0
  for (let i = 0; i < N; i++) {
    let minDist = Infinity, minC = 0
    const iBase = i * D
    for (let c = 0; c < C; c++) {
      let dist = 0
      const cBase = c * D
      for (let d = 0; d < D; d++) {
        const diff = features[iBase + d] - centroids[cBase + d]
        dist += diff * diff
      }
      if (dist < minDist) { minDist = dist; minC = c }
    }
    if (assignments[i] !== minC) { assignments[i] = minC; changed++ }
  }

  counts.fill(0)
  centroids.fill(0)
  for (let i = 0; i < N; i++) {
    const c = assignments[i]
    counts[c]++
    const iBase = i * D, cBase = c * D
    for (let d = 0; d < D; d++) centroids[cBase + d] += features[iBase + d]
  }
  for (let c = 0; c < C; c++) {
    if (counts[c] > 0) {
      const cBase = c * D
      const cnt = counts[c]
      for (let d = 0; d < D; d++) centroids[cBase + d] /= cnt
    }
  }

  console.log(`  Iter ${iter + 1}/${KMEANS_ITER}: ${changed} mudanças`)
  if (changed === 0) break
}

console.timeEnd('K-means')

// Formato binário IVF:
// [N: u32][D: u32][C: u32][centroids: Float32 C*D][assignments: u32 N][features: Float32 N*D][labels: u8 N]
const header = Buffer.alloc(12)
header.writeUInt32LE(N, 0)
header.writeUInt32LE(D, 4)
header.writeUInt32LE(C, 8)

const bin = Buffer.concat([
  header,
  Buffer.from(centroids.buffer),
  Buffer.from(new Uint8Array(assignments.buffer)),
  Buffer.from(features.buffer),
  Buffer.from(labels.buffer)
])

writeFileSync('./model.bin', bin)
console.log(`\nModelo IVF salvo: ${(bin.length / 1024 / 1024).toFixed(2)} MB`)
console.log(`  N=${N}, D=${D}, C=${C}`)
console.timeEnd('Total')
