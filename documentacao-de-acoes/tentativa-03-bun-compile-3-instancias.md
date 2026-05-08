# Tentativa 03 — bun build --compile + 3ª instância de API

**Data:** 2026-05-08  
**Branch:** teste-02

---

## Contexto

Configuração anterior (tentativa 02): 2 instâncias API com Bun runtime direto.
- api1 + api2: 0.45 CPU / 165MB cada  
- nginx: 0.10 CPU / 20MB  
- Total: 1.0 CPU / 350MB ✓

A ideia central era: compilar o servidor com `bun build --compile` para emitir um binário standalone com runtime embutido, reduzindo ~10–15MB de RAM por instância. Com essa economia, seria possível adicionar uma 3ª instância de API sem ultrapassar o limite de 350MB.

---

## Alterações implementadas

### 1. Dockerfile — Multi-stage com bun build --compile

**Antes:**
```dockerfile
FROM oven/bun:1-alpine
WORKDIR /app
COPY package.json .
COPY src/ src/
CMD ["bun", "src/server.js"]
```

**Depois:**
```dockerfile
FROM oven/bun:1-alpine AS builder
WORKDIR /app
COPY package.json .
COPY src/ src/
RUN bun build --compile --minify src/server.js --outfile /server

FROM alpine:3
RUN apk add --no-cache libstdc++ libgcc
COPY --from=builder /server /server
CMD ["/server"]
```

**Por quê `libstdc++ libgcc`?** O binário compilado pelo Bun no Alpine usa musl libc mas ainda é dinamicamente vinculado a `libstdc++` e `libgcc`. A imagem `alpine:3` base não inclui essas bibliotecas — sem elas, o container sobe com erros `Error relocating /server: symbol not found`. As libs adicionam apenas ~3MB à imagem final.

**Tamanho da imagem:**
- Antes (oven/bun:1-alpine): ~120MB
- Depois (alpine:3 + libs + binário): 107MB
- Ganho: ~13MB por imagem

### 2. src/service.ivf.js — Correção do caminho do model.bin

**Problema:** Com `bun build --compile`, `import.meta.url` aponta para o caminho do executável em runtime (ex.: `file:///server`), não para o arquivo source. Isso fazia `dirname(fileURLToPath(import.meta.url))` retornar `/` e o `join('/', '../model.bin')` resolver para `/model.bin` (errado).

**Solução:**
```js
// Antes
const buf = readFileSync(join(__dirname, '../model.bin'))

// Depois
const MODEL_PATH = process.env.MODEL_PATH
  ?? join(dirname(fileURLToPath(import.meta.url)), '../model.bin')
const buf = readFileSync(MODEL_PATH)
```

O `MODEL_PATH` é definido via variável de ambiente no `docker-compose.yml` (`MODEL_PATH: /app/model.bin`), garantindo que o binário compilado encontre o modelo independente de onde esteja o executável. O fallback com `import.meta.url` mantém compatibilidade para desenvolvimento local.

### 3. docker-compose.yml — 3ª instância + redistribuição de recursos

**Nova distribuição (total: 1.0 CPU / 350MB):**

| Serviço | CPU (antes) | CPU (depois) | RAM (antes) | RAM (depois) |
|---------|-------------|--------------|-------------|--------------|
| api1    | 0.45        | 0.30         | 165MB       | 108MB        |
| api2    | 0.45        | 0.30         | 165MB       | 108MB        |
| api3    | —           | 0.30         | —           | 108MB        |
| nginx   | 0.10        | 0.10         | 20MB        | 26MB         |
| **Total** | **1.00**  | **1.00**     | **350MB**   | **350MB**    |

**Por quê nginx ganhou 6MB?** Em idle o nginx já consumia 17.98MB / 20MB (89.9% do limite). Sob carga com mais conexões distribuídas para 3 backends, havia risco de OOM. Redistribuímos 6MB dos workers para o nginx.

**Uso de memória em idle após implementação:**
| Container | RAM usada | Limite | % |
|-----------|-----------|--------|---|
| api1      | 20.83MB   | 108MB  | 19.3% |
| api2      | 20.84MB   | 108MB  | 19.3% |
| api3      | 20.82MB   | 108MB  | 19.3% |
| nginx     | 17.6MB    | 26MB   | 67.7% |

Cada API usa apenas ~21MB em idle (runtime Bun compilado ~10MB + dados do modelo ~11.7MB carregados via mmap/typed array views).

### 4. nginx/nginx.conf — adição de api3 no upstream

```nginx
upstream api {
  server api1:3000;
  server api2:3000;
  server api3:3000;  # ← novo
  keepalive 128;
  keepalive_requests 10000;
}
```

---

## Resultados do teste (k6)

**Total de requisições:** 54.100

| Métrica | Valor |
|---------|-------|
| p99 | **54.35ms** |
| failure_rate | **2.28%** |
| http_errors | **0** |
| true_positive (fraudes detectadas) | 23.816 / 24.058 |
| true_negative (legítimas aprovadas) | 29.010 / 30.042 |
| false_positive | 1.011 |
| false_negative | 221 |
| weighted_errors_E | 1.674 |
| error_rate_epsilon | 0.030967 |
| p99_score | 1264.77 (sem corte) |
| detection_score | 541.9 |
| **final_score** | **1806.67** |

---

## Análise

- **Zero erros HTTP** — todos os requests respondidos
- **p99 de 54ms** — dentro do threshold, sem corte no p99_score
- **3 instâncias com 0.30 CPU cada** funcionaram sem gargalo visível
- O binário compilado (~107MB de imagem vs ~120MB) economizou espaço em disco/registry, mas o impacto na RAM em runtime foi mínimo (Bun já usa ~20-25MB de base no Alpine também)
- A 3ª instância distribui melhor a carga do k6 sem violar os limites de recursos

---

## Riscos identificados e mitigações

| Risco | Status |
|-------|--------|
| `import.meta.url` incorreto no binário compilado | Mitigado via `MODEL_PATH` env var |
| `libstdc++`/`libgcc` ausente no Alpine base | Mitigado adicionando as libs no Dockerfile |
| nginx OOM com 3 backends | Mitigado aumentando limite para 26MB |

---

## Próximos passos sugeridos

- Ajustar threshold de fraud (atualmente 0.4 → fraude se ≥ 2/5 vizinhos): 1.011 falsos positivos vs 221 falsos negativos indica que o modelo erra mais para o lado "fraude" — subir o threshold pode melhorar
- Testar PROBE = 12 ou 16 no IVF (mais clusters analisados = mais precisão, mas mais CPU)
- Analisar se `N = 200000` é ótimo ou se subir para 300k/400k melhoraria a detection_score
