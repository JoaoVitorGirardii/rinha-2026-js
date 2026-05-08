# Análise: Early Exit para Detecção de Fraude

## Contexto

Estado atual do projeto antes desta análise:
- `final_score`: 1469.61
- `p99`: 77.62ms (target: 1–5ms)
- `failure_rate`: 2.22% (FP=641, FN=557)
- N=200k amostras, IVF C=500 clusters, PROBE=20

## Descoberta Principal

**66% do tráfego pode ser classificado com 6 comparações numéricas, sem tocar no KNN.**

Esses padrões foram **validados contra os 3 milhões de registros do `references.json`** — não são overfitting ao arquivo de teste.

---

## As duas regras de early exit

### Regra 1 — "Obviamente Legítima" → retorna `approved: true` (0 votos de fraude)

```
unknown_merchant === 0   // merchant está em customer.known_merchants
AND amount_vs_avg < 0.15  // valor ≤ 1,5× a média do cliente
AND km_from_home  < 0.05  // terminal a menos de 50 km de casa
AND mcc_risk      <= 0.30 // categoria de baixo risco (5411, 5812, 5912, 5311)
AND tx_count_24h  < 0.40  // menos de ~8 transações nas últimas 24h
AND amount        < 0.10  // valor bruto < R$ 1.000
```

Índices no vetor Float32Array de 14 posições: `v[11], v[2], v[7], v[12], v[8], v[0]`

**Resultados validados:**
| Dataset | Cobertura | Erros (FN) | Taxa erro |
|---|---|---|---|
| test-data.json (54k) | 21.525 transações (39,8%) | 0 | 0,000% |
| references.json (3M) | 1.946.029 de 2.000.594 legítimas (97,3%) | 15 | 0,001% |

---

### Regra 2 — "Obviamente Fraude" → retorna `approved: false` (5 votos de fraude)

```
unknown_merchant === 1   // merchant desconhecido
AND amount_vs_avg  > 0.80 // valor > 8× a média do cliente
AND mcc_risk      >= 0.75 // categoria de alto risco (7801, 7802, 7995)
AND km_from_home  > 0.50  // terminal a mais de 500 km de casa
AND tx_count_24h  > 0.40  // mais de ~8 transações nas últimas 24h
```

**Resultados validados:**
| Dataset | Cobertura | Erros (FP) | Taxa erro |
|---|---|---|---|
| test-data.json (54k) | 14.198 transações (26,2%) | 0 | 0,000% |
| references.json (3M) | 544.278 de 999.406 fraudes (54,5%) | 0 | 0,000% |

---

## Impacto combinado

```
Early exit LEGIT:  39,8% do tráfego → 0 erros
Early exit FRAUD:  26,2% do tráfego → 0 erros
─────────────────────────────────────────────
Total early exit:  66,0% do tráfego → 0 erros
Vai para o KNN:    34,0% do tráfego (18.377 transações)
```

O KNN só precisa processar 34% das requisições. Isso reduz a pressão de CPU de forma que:
- O p99 cai significativamente (menos fila, menos contenção)
- A acurácia geral melhora (menos chamadas, menos erros do KNN)

---

## Como implementar no `service.ivf.js`

Adicionar no início da função `knnScoreService`, antes do loop IVF:

```javascript
export function knnScoreService(vector) {
  // === EARLY EXIT: regras determinísticas (66% do tráfego, 0 erros) ===
  const unknown   = vector[11]  // unknown_merchant
  const amtVsAvg  = vector[2]   // amount_vs_avg
  const kmHome    = vector[7]   // km_from_home
  const mccRisk   = vector[12]  // mcc_risk
  const tx24h     = vector[8]   // tx_count_24h
  const amount    = vector[0]   // amount

  // Obviamente legítima: merchant conhecido + valor baixo + perto de casa + baixo risco
  if (unknown === 0 && amtVsAvg < 0.15 && kmHome < 0.05 && mccRisk <= 0.3 && tx24h < 0.4 && amount < 0.1) {
    return 0  // 0/5 votos → fraud_score=0.0, approved=true
  }

  // Obviamente fraude: merchant desconhecido + valor muito alto + alto risco + longe + frequente
  if (unknown === 1 && amtVsAvg > 0.8 && mccRisk >= 0.75 && kmHome > 0.5 && tx24h > 0.4) {
    return 5  // 5/5 votos → fraud_score=1.0, approved=false
  }

  // ... resto do código IVF existente
}
```

---

## Por que as regras são robustas (não overfitting)

As fronteiras são conservadoras e refletem lógica de negócio real:

- **Legítima**: cliente comprando em merchant que já conhece, valor dentro do padrão, perto de casa, em categoria sem risco, sem frequência suspeita. Esse padrão é genuinamente seguro em qualquer distribuição.
- **Fraude**: merchant novo para o cliente, valor muitíssimo acima do padrão (8×), em categoria de altíssimo risco (cassinos/jogos de azar = MCC 7801/7802/7995), longe de casa, com muitas transações recentes. Esse padrão é genuinamente suspeito em qualquer distribuição.

Os thresholds foram escolhidos com margem: mesmo que a distribuição do teste final seja diferente, a lógica se mantém porque estão validados nos 3M do `references.json`.

---

## Estimativa de score após implementação

Considerando KNN com 97–98% de acurácia no subconjunto de 34%:

| p99 | failure_rate est. | final_score est. |
|---|---|---|
| 10ms | ~1,7% | ~2.470 |
| 5ms  | ~1,7% | ~2.770 |
| 1ms  | ~1,7% | **~3.500** ✓ |

O early exit sozinho **não atinge o target de 3000** — é necessário também otimizar a latência do KNN e/ou aumentar sua acurácia no subconjunto de 34%.

---

## Arquivos relevantes

| Arquivo | Papel |
|---|---|
| `src/service.ivf.js` | Onde implementar o early exit (início de `knnScoreService`) |
| `src/func.js` | Extração do vetor — os índices acima se referem ao array retornado aqui |
| `src/server.js` | `RESPONSES[votes]`: 0=approved, 5=denied |
| `scripts/train.js` | Retreino do modelo IVF (N=200k, C=500, PROBE=20 atualmente) |
| `references.json` | 3M registros de referência (33% fraude, 67% legítima) |

---

## Estado atual do modelo (antes da implementação)

```json
{
  "p99": "77.62ms",
  "scoring": {
    "breakdown": { "false_positive_detections": 641, "false_negative_detections": 557,
                   "true_positive_detections": 23476, "true_negative_detections": 29379 },
    "failure_rate": "2.22%",
    "weighted_errors_E": 2312,
    "final_score": 1469.61
  }
}
```
