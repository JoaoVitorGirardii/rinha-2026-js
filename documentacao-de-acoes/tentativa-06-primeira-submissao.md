# Tentativa 06 — Primeira Submissão

**Data:** 2026-05-08

## O que foi feito

Preparação e publicação da primeira submissão para a Rinha de Backend 2026.

## Mudanças realizadas

### Dockerfile (branch `main`)
- Adicionado `COPY model-tree.json /app/model-tree.json` no runtime stage (alpine)
- Isso torna a imagem Docker auto-suficiente, sem depender de volume mount externo
- Testado: imagem funciona sem nenhum volume mount

### info.json (branch `main`)
- Arquivo criado com metadados do participante:
  - participants, social, source-code-repo, stack, open_to_work
  - Stack: JavaScript, Bun, Nginx, Decision Tree

### Branch `submission` (nova)
- Criada a partir da `main` com apenas 3 arquivos:
  - `docker-compose.yml` — usa `image: joaovitorgirardiii/rinha-2026-js:latest` (sem build, sem volumes de modelo)
  - `nginx/nginx.conf` — configuração do load balancer
  - `info.json` — metadados do participante
- Removidos: código-fonte, scripts, Dockerfile, binários (model.bin, model-tree.json), documentação

### Imagem Docker Hub
- Publicada em: `docker.io/joaovitorgirardiii/rinha-2026-js:latest`
- Digest: `sha256:46dbccaa7d4f60c14baee610a31aa60160ae30e0bed8933a9b90126fc594834d`
- Conteúdo: alpine + libstdc++/libgcc + binário Bun compilado + model-tree.json (Decision Tree, 157 nós)
- Tamanho estimado: pequeno (alpine base)

## Testes realizados

| Teste | Resultado |
|-------|-----------|
| `GET /ready` via nginx | 200 OK ✓ |
| `POST /fraud-score` transação legítima | `{"fraud_score":0,"approved":true}` ✓ |
| `POST /fraud-score` transação fraudulenta | `{"fraud_score":1,"approved":false}` ✓ |
| docker compose up (sem volume model) | OK ✓ |
| Pull da imagem do Docker Hub + up | OK ✓ |

## Recursos

Soma total: 3×0.30 + 0.10 = **1.0 CPU** | 3×108 + 26 = **350MB** ✓

## Próximos passos

1. Fork + PR no repo oficial `zanfranceschi/rinha-de-backend-2026` com `participants/JoaoVitorGirardii.json`
2. Após PR aceito: abrir issue com `rinha/test rinha-2026-js` para preview test
