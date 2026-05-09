import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const MODEL_PATH = process.env.TREE_MODEL_PATH
  ?? join(dirname(fileURLToPath(import.meta.url)), '../model-tree.json')

const model = JSON.parse(readFileSync(MODEL_PATH, 'utf8'))

const MODEL_TYPE = model.model_type ?? 'rf'
const N_TREES = Math.min(model.n_trees, parseInt(process.env.TREE_COUNT ?? model.n_trees))
const THRESHOLD = parseFloat(process.env.TREE_THRESHOLD ?? model.threshold ?? 0.4)
const BIAS = model.bias ?? 0  // para HGB
const isHGB = MODEL_TYPE === 'hgb'

// Arrays planos contíguos (melhor localidade de cache — todos os dados em 5 blocos)
const totalNodes = model.trees.slice(0, N_TREES).reduce((s, t) => s + t.n_nodes, 0)
const _feat   = new Int16Array(totalNodes)
const _thresh = new Float32Array(totalNodes)
const _left   = new Int32Array(totalNodes)
const _right  = new Int32Array(totalNodes)
const _vals   = new Float32Array(totalNodes)
const _offset = new Int32Array(N_TREES + 1)  // offset[t] = início da árvore t no array flat

let pos = 0
for (let t = 0; t < N_TREES; t++) {
  const tree = model.trees[t]
  const src = isHGB ? tree.values : tree.probs
  _offset[t] = pos
  for (let i = 0; i < tree.n_nodes; i++, pos++) {
    _feat[pos]   = tree.features[i]
    _thresh[pos] = tree.thresholds[i]
    _left[pos]   = tree.lefts[i] === -1 ? -1 : tree.lefts[i] + _offset[t]
    _right[pos]  = tree.rights[i] === -1 ? -1 : tree.rights[i] + _offset[t]
    _vals[pos]   = src[i]
  }
}
_offset[N_TREES] = pos

const typeLabel = isHGB ? 'HGB' : 'Random Forest'
console.log(`${typeLabel} pronto: ${N_TREES} árvores, ${totalNodes} nós, threshold=${THRESHOLD}${isHGB ? `, bias=${BIAS}` : ''}`)

// sigmoid(x) = 1 / (1 + e^-x) — usado apenas para HGB
function sigmoid(x) { return 1 / (1 + Math.exp(-x)) }

export function knnScoreService(vector) {
  let acc = 0
  for (let t = 0; t < N_TREES; t++) {
    let idx = _offset[t]
    while (_left[idx] !== -1) {
      idx = vector[_feat[idx]] <= _thresh[idx] ? _left[idx] : _right[idx]
    }
    acc += _vals[idx]
  }

  // RF: avg probability ≥ threshold → fraud
  // HGB: sigmoid(bias + sum_leaves) ≥ threshold → fraud
  const prob = isHGB ? sigmoid(BIAS + acc) : acc / N_TREES
  return prob >= THRESHOLD ? 5 : 0
}
