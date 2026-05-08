# Tentativa 04 — Threshold, PROBE e retraining N=600K

**Data:** 2026-05-08  
**Branch:** teste-02  
**Base:** Tentativa 03 (bun compile + 3 instâncias)

---

## Contexto

Com o setup da tentativa 03 estabilizado (score 1806.67, p99 54.35ms), foram identificados 3 eixos de melhoria:

1. O threshold de aprovação estava mal calibrado em relação aos pesos da função de score
2. O PROBE do IVF poderia ser aumentado para melhorar recall
3. O modelo usava apenas 6.7% dos 3M de amostras disponíveis

Todos os passos foram aplicados isoladamente para medir o impacto individual de cada um.

---

## Tabela de resultados (todos os passos)

| Passo | Mudança | Score | p99 | FP | FN | wErrors | Δ Score |
|-------|---------|-------|-----|----|----|---------|---------|
| Baseline (t03) | N=200K, C=500, PROBE=8, thr=0.4 | 1806.67 | 54.35ms | 1011 | 221 | 1674 | — |
| 1a | Threshold 0.4 → 0.2 | **1925.43** | 56.31ms | 1200 | 40 | 1320 | **+118.76** |
| 1b | PROBE 8 → 12 (revertido) | 1899.44 | 59.72ms | 1201 | 40 | 1321 | −25.99 |
| 1b rev. | PROBE 12 → 8 (restaurado) | ≈1925 | ≈56ms | — | — | — | — |
| **2** | **N=600K, C=1200** | **2185.46** | **31.98ms** | **1203** | **28** | **1287** | **+260.03** |
| 3 | N=1M, C=2000 | cancelado | — | — | — | — | — |

**Score total acumulado vs baseline: +378.79 (+20.9%)**

---

## Passo 1a — Threshold 0.4 → 0.2

### O que foi feito
Alterado `src/server.js`: `approved = fraud_score < 0.4` → `approved = fraud_score < 0.2`

O threshold define quando uma transação é aprovada. Com threshold=0.4, transações com 0 ou 1 vizinho fraude (entre 5) eram aprovadas. Com threshold=0.2, apenas transações com 0 vizinhos fraude são aprovadas.

### Por que baixar e não subir?

A função de score penaliza os erros com pesos distintos:
- Falso positivo (legítima bloqueada): peso **1**
- Falso negativo (fraude aprovada): peso **3**

Confirmação dos pesos pelo resultado do baseline:
```
1011 × 1 + 221 × 3 = 1011 + 663 = 1674  ✓
```

Com FN custando 3×, ser mais agressivo na detecção de fraude é vantajoso enquanto a proporção FP/FN trocada for menor que 3:1. No baseline, o custo de FP (1011) era muito maior que o de FN (663) — havia folga para trocar.

### Resultado
- FN: 221 → 40 (−181 fraudes passando)
- FP: 1011 → 1200 (+189 legítimas bloqueadas)
- Penalidade: eliminada 181×3=543, adicionada 189×1=189 → **ganho líquido: −354 na penalidade**
- Score: 1806.67 → **1925.43 (+118.76)**
- p99: 54.35ms → 56.31ms (+1.96ms) — sem impacto no score de p99

### Tradeoff
Mais transações legítimas sendo bloqueadas (+189 FP) em troca de muito menos fraudes passando (−181 FN). Favorável dado o peso 3:1 do scoring.

---

## Passo 1b — PROBE 8 → 12 (revertido)

### O que foi feito
Alterado `src/service.ivf.js`: `PROBE = 8` → `PROBE = 12`

PROBE é o número de clusters IVF que o algoritmo visita por query. Mais clusters = maior recall (menos fraudes escondidas em clusters não visitados) mas mais CPU por request.

### Resultado
- FP/FN: praticamente idênticos (1200→1201 / 40→40) — **a precisão não melhorou**
- p99: 56.31ms → 59.72ms (+3.41ms)
- p99_score: 1249.42 → 1223.85 (−25.57 só pelo p99 mais alto)
- Score: 1925.43 → **1899.44 (−25.99)**

### Por que não melhorou a precisão?
Com N=200K e C=500, cada cluster tinha ~400 pontos. Os 8 clusters mais próximos ao centroide da query já cobrem a região relevante do espaço de features com boa densidade. O 9º ao 12º cluster mais próximos estavam suficientemente longe para não conter vizinhos melhores. O gargalo não era o PROBE, e sim a quantidade de amostras no modelo.

### Tradeoff e decisão
Mais CPU por request sem ganho de precisão. **Revertido para PROBE=8.**

Lição: antes de aumentar PROBE, é mais eficiente melhorar a qualidade do modelo (mais dados, melhor clustering). PROBE só ajuda se os vizinhos verdadeiros estiverem em clusters não visitados, o que depende da densidade do índice.

---

## Passo 2 — Retraining N=600K, C=1200

### O que foi feito
- `scripts/train.js`: `MAX_SAMPLES = 200000` → `600000`, `C = 500` → `1200`
- Executado `node scripts/train.js` fora dos containers (model.bin é volume montado)
- Reiniciados os containers sem rebuild de imagem Docker

**Parâmetros de treino:**
- Amostras: 600.000 (210.000 fraudes + 390.000 legítimas)
- Clusters: C=1200 (proporcional: mantém ~500 pts/cluster como no modelo anterior)
- Iterações k-means: 25
- Tempo de treino: **14 minutos e 49 segundos**
- Tamanho do model.bin: **34.97MB** (era 11.7MB)

### Análise de memória
| Componente | Antes (N=200K) | Depois (N=600K) |
|-----------|---------------|----------------|
| model.bin em RAM | 11.7MB | 35.0MB |
| clusterIndices | 0.8MB | 2.3MB |
| Bun runtime | ~9MB | ~9MB |
| **Total por instância** | **~21MB** | **~46MB** |
| **Headroom (limite 108MB)** | **87MB** | **62MB** |

Consumo ainda confortável: 43% do limite de memória, 62MB de folga.

### Resultado
- FN: 40 → 28 (−12 fraudes passando)
- FP: 1200 → 1203 (+3 — praticamente idêntico)
- p99: 56.31ms → **31.98ms (−24ms!)**
- Score: 1925.43 → **2185.46 (+260.03)**

### Por que o p99 caiu tanto com mais dados?

Dois fatores:

**1. Melhor qualidade do índice IVF:** Com 3× mais amostras e clusters proporcionalmente escalados (C=1200 vs 500), os centroides representam o espaço de features com muito mais precisão. Queries chegam a clusters mais "limpos" e homogêneos, reduzindo a busca em pontos irrelevantes.

**2. Menos variância no tempo de resposta:** Com clustering melhor, os 8 clusters visitados por query têm tamanhos mais uniformes (~500 pts cada em vez de clusters desequilibrados). Isso elimina os casos de pior caso que puxam o p99 para cima.

O custo de CPU por query aumentou (mais centroide scan: 1200×14 vs 500×14), mas esse custo é pequeno e previsível comparado com a redução na variância do tempo total de busca.

### Tradeoff
- Treino ~9× mais lento (14min vs ~1.5min estimado para 200K)
- model.bin 3× maior em disco e memória
- Ganho enorme: +260 pontos no score e p99 cai quase pela metade

---

## Passo 3 — N=1M, C=2000 (cancelado)

### O que seria
- `MAX_SAMPLES = 1000000`, `C = 2000`
- model.bin estimado: ~58MB por instância
- Memória total estimada por instância: ~71MB (66% do limite, 37MB de folga)
- Tempo de treino estimado: ~40-50 minutos
- CPU por request: ~1.6× o atual (N=600K)

### Por que foi cancelado
Decisão do usuário — o N=600K já entregou resultado muito bom e havia outra otimização a explorar. O N=1M permanece como opção futura se necessário.

---

## Estado final

**Configuração ativa:**
- N=600K, C=1200, PROBE=8, threshold=0.2
- 3 instâncias: 0.30 CPU / 108MB cada
- nginx: 0.10 CPU / 26MB
- Imagem: alpine:3 + bun compiled binary (~107MB)

**Score final: 2185.46**  
**p99: 31.98ms**  
**http_errors: 0**

---

## Resumo das lições

| Lição | Detalhe |
|-------|---------|
| Sempre calcular os pesos do scoring antes de ajustar threshold | wFN=3 inverteu a direção óbvia: "mais FP do que FN" não significa que deve ser menos agressivo |
| PROBE só resolve se o gargalo for recall de vizinhos | Se os vizinhos verdadeiros já estão nos clusters visitados, PROBE maior só adiciona CPU |
| Mais dados + C proporcional melhora p99, não só precisão | Melhor clustering reduz variância no tempo de busca — efeito surpresa mas consistente |
| model.bin é separado da imagem Docker | Retraining não exige rebuild — basta reiniciar os containers com o novo volume |
