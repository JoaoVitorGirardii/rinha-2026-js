# Tentativa 05 — Decision Tree (substituição do IVF-KNN)

**Data:** 2026-05-08  
**Branch:** teste-02

---

## Motivação

O IVF-KNN tinha p99 de ~49ms mesmo após o early exit. O gargalo é estrutural: mesmo com early exit cobrindo 66% do tráfego, os 34% restantes exigem calcular distância euclidiana para centenas de pontos por request. A Decision Tree resolve isso — inferência é O(profundidade), ou seja, ~15 comparações máximas por request, independente do tamanho do dataset.

---

## Decisão

Substituir `src/service.ivf.js` por `src/service.tree.js`:
- Mantém o **early exit determinístico** (66% do tráfego, 0 erros validados)
- Substitui o loop IVF por **traversal de Decision Tree** para os 34% restantes

---

## O que foi implementado

### 1. `scripts/train-tree.py` (Python + scikit-learn)

- Lê `references.json` (3M registros pré-vetorizados)
- Subamostrada estratificada: 300k registros (99.9k fraudes, 200k legítimas)
- Treina `DecisionTreeClassifier`:
  - `max_depth=15`
  - `min_samples_leaf=100`
  - `class_weight='balanced'`
  - `criterion='gini'`
- Exporta como `model-tree.json` com parallel arrays para TypedArrays no JS:
  - `features[]` (Int16), `thresholds[]` (Float32), `lefts[]`, `rights[]`, `values[]`
- Resultado do treinamento: **157 nós, 2.8 KB, failure_rate 1.68% na validação (holdout 10%)**

### 2. `src/service.tree.js` (inferência JS)

- Carrega `model-tree.json` via `TREE_MODEL_PATH` env var (mesmo padrão de `MODEL_PATH` do serviço anterior)
- TypedArrays para traversal cache-friendly
- Early exit idêntico ao `service.ivf.js`
- Tree traversal:
  ```javascript
  let idx = 0
  while (_left[idx] !== -1) {
    idx = vector[_feat[idx]] <= _thresh[idx] ? _left[idx] : _right[idx]
  }
  return _val[idx]  // 0 (legítima) ou 5 (fraude)
  ```
  - Condição `<=` é o comportamento padrão do sklearn (go left if ≤ threshold)
  - Folhas retornam 0 ou 5 votos (compatível com `RESPONSES[votes]` em server.js)

### 3. `src/server.js`

- Mudança de 1 linha: `import ... from './service.tree.js'`

### 4. `docker-compose.yml`

- Volumes e env vars trocados de `model.bin`/`MODEL_PATH` para `model-tree.json`/`TREE_MODEL_PATH`
- Recursos (CPU/memória) inalterados

---

## Resultado do Teste

| Métrica               | IVF-KNN puro | IVF-KNN + early exit | **Decision Tree + early exit** |
|-----------------------|--------------|----------------------|-------------------------------|
| final_score           | 1469.61      | 1850.99              | **3440.29**                   |
| p99                   | 77.62ms      | 49.08ms              | **1.71ms**                    |
| failure_rate          | 2.22%        | 2.28%                | 2.30%                         |
| false_positive (FP)   | 641          | 1011                 | 1200                          |
| false_negative (FN)   | 557          | 221                  | **42**                        |
| weighted_errors_E     | 2312         | 1674                 | **1326**                      |

### Destaques

- **p99 caiu 97%**: de 49ms para 1.71ms (abaixo do target de 5ms)
- **FN caiu 81%**: de 221 para 42 — muito menos fraudes passando sem detectar
- **final_score +86%**: de 1850 para 3440 — já acima do target de 3000
- Modelo passou de 11.7MB (model.bin) para 2.8KB (model-tree.json)
- Tamanho menor do modelo também reduz pressão de memória por instância

---

## Por que o FP subiu?

A Decision Tree foi treinada com `class_weight='balanced'`, o que a torna mais agressiva na detecção de fraude (reduz FN a custo de mais FP). O resultado final ainda é melhor porque FN é penalizado mais pesado no scoring da competição.

---

## Arquivos alterados/criados

| Arquivo | Mudança |
|---|---|
| `scripts/train-tree.py` | Novo — treinamento Python/sklearn |
| `src/service.tree.js` | Novo — inferência JS com tree traversal |
| `src/server.js` | 1 linha — troca import para `service.tree.js` |
| `docker-compose.yml` | Volume e env var do novo modelo |
| `model-tree.json` | Novo — árvore serializada (157 nós, 2.8 KB) |
