# Tentativa 04 — Early Exit Determinístico (66% do tráfego)

**Data:** 2026-05-08  
**Branch:** teste-02

---

## Objetivo

Implementar duas regras determinísticas no início de `knnScoreService` para classificar 66% do tráfego sem passar pelo IVF/KNN, reduzindo CPU e latência.

---

## O que foi feito

Adicionado early exit no início de `src/service.ivf.js`, função `knnScoreService`, antes do loop IVF:

```javascript
// Obviamente legítima: merchant conhecido + valor baixo + perto de casa + baixo risco
if (vector[11] === 0 && vector[2] < 0.15 && vector[7] < 0.05 && vector[12] <= 0.3 && vector[8] < 0.4 && vector[0] < 0.1) {
  return 0  // 0/5 votos → fraud_score=0.0, approved=true
}
// Obviamente fraude: merchant desconhecido + valor muito alto + alto risco + longe + frequente
if (vector[11] === 1 && vector[2] > 0.8 && vector[12] >= 0.75 && vector[7] > 0.5 && vector[8] > 0.4) {
  return 5  // 5/5 votos → fraud_score=1.0, approved=false
}
```

### Índices do vetor (Float32Array de 14 posições em `src/func.js`)

| Índice | Feature         | Threshold Legít. | Threshold Fraude |
|--------|-----------------|------------------|------------------|
| v[0]   | amount          | < 0.10           | —                |
| v[2]   | amount_vs_avg   | < 0.15           | > 0.80           |
| v[7]   | km_from_home    | < 0.05           | > 0.50           |
| v[8]   | tx_count_24h    | < 0.40           | > 0.40           |
| v[11]  | unknown_merchant| === 0            | === 1            |
| v[12]  | mcc_risk        | <= 0.30          | >= 0.75          |

---

## Resultado

| Métrica               | Antes (KNN/IVF puro) | Depois (+ early exit) | Variação     |
|-----------------------|----------------------|-----------------------|--------------|
| final_score           | 1469.61              | **1850.99**           | +381 (+26%)  |
| p99                   | 77.62ms              | 49.08ms               | -28.54ms     |
| failure_rate          | 2.22%                | 2.28%                 | +0.06pp      |
| false_positive (FP)   | 641                  | 1011                  | +370         |
| false_negative (FN)   | 557                  | 221                   | -336         |
| weighted_errors_E     | 2312                 | 1674                  | -638         |

### Observação sobre FP x FN

O aumento de FP (641→1011) foi compensado pela grande queda de FN (557→221). O scoring penaliza FN mais pesado que FP (fraudes passando como legítimas são piores do que falsos alarmes). Por isso o weighted_errors_E caiu mesmo com mais FPs.

A análise original projetava 0 erros nas regras, porém o FP real de +370 sugere que a regra "obviamente fraude" tem alguns falsos positivos no conjunto de teste atual. A regra é conservadora o suficiente para ter valor positivo (+381 no score final).

---

## Próximos passos

Para atingir o target de score 3000+, ainda é necessário:

1. **Reduzir FP da regra de fraude**: afrouxar levemente os thresholds (ex: `mcc_risk >= 0.80` em vez de `>= 0.75`) para reduzir falsos alarmes.
2. **Otimizar o IVF/KNN para o subconjunto de 34%**: esses 34% são os casos difíceis — retreinar com mais amostras nesses casos.
3. **Reduzir p99**: ainda em 49ms, target é 1–5ms. Considerar aumentar número de instâncias ou otimizar o loop IVF.

---

## Arquivos alterados

- `src/service.ivf.js` — adicionado early exit no início de `knnScoreService`
