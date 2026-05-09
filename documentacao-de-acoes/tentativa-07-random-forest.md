# Tentativa 07 — Random Forest (50 árvores, 2M amostras)

**Data:** 2026-05-08

## Estado anterior (tentativa-05/06 — Decision Tree)

```json
{
  "p99": "1.71ms",
  "scoring": {
    "breakdown": {
      "false_positive_detections": 1200,
      "false_negative_detections": 42,
      "true_positive_detections": 23995,
      "true_negative_detections": 28822,
      "http_errors": 0
    },
    "failure_rate": "2.3%",
    "weighted_errors_E": 1326,
    "final_score": 3440.29
  }
}
```

## Análise da fórmula de scoring

A fórmula completa encontrada em `test/test.js`:
```
E = FP×1 + FN×3 + errors×5
epsilon = E / N (N = 54100 total)
p99Score  = 1000 × log10(1000 / max(p99_ms, 1))   → max = 3000 em p99=1ms
rateComp  = 1000 × log10(1 / max(epsilon, 0.001))  → max = 3000 em E=0
absPen    = -300 × log10(1 + E)
detScore  = rateComp + absPen
finalScore = p99Score + detScore                    → MAX = 6000
```

Tabela de E necessário para diferentes pontuações:
| E (weighted errors) | detScore | final (p99=1.71ms) | final (p99=1ms) |
|---------------------|----------|--------------------|-----------------|
| 1326 (atual)        |   673    |       3440         |      3673       |
| 500                 |  1224    |       3990         |      4224       |
| 200                 |  1741    |       4507         |      4741       |
| 50                  |  2488    |       5254         |      5488       |
| 10                  |  2687    |       5453         |      5687       |
| 0                   |  3000    |       5766         |      6000       |

Para atingir 5800: precisa de E≈0 com p99≈1ms, **ou** E<5 com p99≈1.6ms.

## Diagnóstico dos 1200 FPs

Raiz do problema: a Decision Tree única cria folhas "mistas" onde amostras legítimas
e fraudulentas coexistem. Com majority-vote (threshold=0.5), toda a folha é chamada
de fraude → FPs para os legítimos que caíram lá.

Threshold abaixado para 0.05 (otimizado no validation set) não resolve se a árvore
fundamentalmente não consegue separar os borderline cases — apenas troca FPs por FNs.

## Solução: Random Forest (ensemble de 50 árvores)

### Por que RF melhora?

1. **Reduz variância**: cada árvore vê subconjunto aleatório de dados e features →
   o ensemble cancela erros individuais
2. **Probabilidades mais calibradas**: média de 50 estimativas → mais estável
3. **Menor overfitting**: árvores mais rasas (max_depth=12) + bagging

### Parâmetros de treinamento

```python
RandomForestClassifier(
    n_estimators=50,        # 50 árvores
    max_depth=12,           # ligeiramente menor que a DT (era 15)
    min_samples_leaf=200,   # maior para RF (mais regularização)
    max_features='sqrt',    # sqrt(14)≈4 features por split (padrão RF)
    class_weight='balanced',
    n_jobs=-1,              # treino paralelo
)
MAX_SAMPLES = 2_000_000   # 2M de amostras (era 300k → 1M)
```

### Custo de inferência

- 50 árvores × max_depth=12 = **600 comparações por request**
- ~1μs → p99 não aumenta perceptivelmente
- Memória: 50 trees × ~300 nodes × 18 bytes = ~270KB por instância

### Formato do modelo (model-tree.json)

```json
{
  "n_trees": 50,
  "threshold": 0.25,   // otimizado no validation set
  "trees": [
    {
      "n_nodes": 300,
      "features": [...],
      "thresholds": [...],
      "lefts": [...],
      "rights": [...],
      "probs": [...]     // probabilidade de fraude em cada folha
    },
    ...  // 50 árvores no total
  ]
}
```

## Resultado esperado

| Métrica | Antes | Esperado |
|---------|-------|----------|
| FP      | 1200  | 100-300  |
| FN      | 42    | 50-100   |
| E       | 1326  | 200-500  |
| Score   | 3440  | 4500-5500|

## Resultado obtido

*(preencher após testes)*

```
p99: ___
FP: ___
FN: ___
E: ___
final_score: ___
```

## Arquivos modificados

- `scripts/train-tree.py`: RandomForestClassifier, 2M amostras, exporta N árvores
- `src/service.tree.js`: ensemble inference (média de probabilidades das 50 árvores)
- `model-tree.json`: novo formato com array de árvores
