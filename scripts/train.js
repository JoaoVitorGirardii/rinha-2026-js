import { readFileSync, writeFileSync } from 'node:fs'

const MAX_SAMPLES = 100000
const D = 14

console.time('Tempo de processamento')
console.log('Lendo references.json...')
const refs = JSON.parse(readFileSync('./references.json', 'utf-8'))
console.log(`${refs.length} itens carregados.`)

// Sampling estratificado: separa fraud e legit para garantir representatividade
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

// Garante ao menos 30% de fraudes nas amostras
const fraudRatio = fraudRefs.length / refs.length
const fraudTarget = Math.min(fraudRefs.length, Math.max(Math.floor(MAX_SAMPLES * 0.30), Math.floor(fraudRatio * MAX_SAMPLES)))
const legitTarget = Math.min(legitRefs.length, MAX_SAMPLES - fraudTarget)

const sampledFraud = sampleEvenly(fraudRefs, fraudTarget)
const sampledLegit = sampleEvenly(legitRefs, legitTarget)

// Intercala fraudes e legítimas em vez de embaralhar (determinístico)
const sampled = []
const maxLen = Math.max(sampledFraud.length, sampledLegit.length)
for (let i = 0; i < maxLen; i++) {
  if (i < sampledFraud.length) sampled.push(sampledFraud[i])
  if (i < sampledLegit.length) sampled.push(sampledLegit[i])
}

const N = sampled.length
console.log(`Usando ${N} amostras (${sampledFraud.length} fraudes, ${sampledLegit.length} legítimas)`)

// Formato binário: [N: u32LE][D: u32LE][features: Float32 N*D][labels: u8 N]
const header = Buffer.alloc(8)
header.writeUInt32LE(N, 0)
header.writeUInt32LE(D, 4)

const features = new Float32Array(N * D)
const labels = new Uint8Array(N)

for (let i = 0; i < N; i++) {
  const r = sampled[i]
  for (let j = 0; j < D; j++) features[i * D + j] = r.vector[j]
  labels[i] = r.label === 'fraud' ? 1 : 0
}

const bin = Buffer.concat([
  header,
  Buffer.from(features.buffer),
  Buffer.from(labels.buffer)
])

writeFileSync('./model.bin', bin)
console.log(`Modelo salvo em model.bin (${(bin.length / 1024 / 1024).toFixed(2)} MB)`)
console.timeEnd('Tempo de processamento')
