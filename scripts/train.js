import { readFileSync, writeFileSync } from 'node:fs'
import KNN from 'ml-knn'

const MAX_SAMPLES = 50000
const labelTempoProcessamento = 'Tempo de processamento: '

console.time(labelTempoProcessamento)
console.log('Lendo references.json...')
const refs = JSON.parse(readFileSync('./references.json', 'utf-8'))
console.log(`${refs.length} itens carregados.`)

const sampled = MAX_SAMPLES >= refs.length ? refs : (() => {
  const step = Math.floor(refs.length / MAX_SAMPLES)
  return refs.filter((_, i) => i % step === 0).slice(0, MAX_SAMPLES)
})()
console.log(`Usando ${sampled.length} amostras para o treinamento.`)

const dataset = sampled.map(r => r.vector)
const labels  = sampled.map(r => r.label)

console.log('Treinando KNN...')
const knn = new KNN(dataset, labels, { k: 3 })

console.log('Serializando modelo...')
writeFileSync('./model.json', JSON.stringify(knn.toJSON()))
console.log('Modelo salvo em model.json')
console.timeEnd(labelTempoProcessamento)
