# Distributed Wagering Processor

[![CI](https://github.com/ULYBR/backend-challenge/actions/workflows/ci.yaml/badge.svg)](https://github.com/ULYBR/backend-challenge/actions/workflows/ci.yaml)
[![Security Scan](https://github.com/ULYBR/backend-challenge/actions/workflows/security-scan.yaml/badge.svg)](https://github.com/ULYBR/backend-challenge/actions/workflows/security-scan.yaml)
[![CD Develop](https://github.com/ULYBR/backend-challenge/actions/workflows/cd-dev.yaml/badge.svg)](https://github.com/ULYBR/backend-challenge/actions/workflows/cd-dev.yaml)
[![CD Production](https://github.com/ULYBR/backend-challenge/actions/workflows/cd-prod.yaml/badge.svg)](https://github.com/ULYBR/backend-challenge/actions/workflows/cd-prod.yaml)
[![Bun](https://img.shields.io/badge/Bun-1.2+-black?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9_Strict-blue?logo=typescript)](https://www.typescriptlang.org)
[![NestJS](https://img.shields.io/badge/NestJS-11-ea2849?logo=nestjs)](https://nestjs.com)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-336791?logo=postgresql)](https://www.postgresql.org)
[![AWS SQS FIFO](https://img.shields.io/badge/AWS-SQS_FIFO-FF9900?logo=amazonsqs)](https://aws.amazon.com/sqs/)
[![Terraform](https://img.shields.io/badge/Terraform-1.9+-7B42BC?logo=terraform)](https://www.terraform.io)
[![Kubernetes](https://img.shields.io/badge/Kubernetes-EKS_1.31-326CE5?logo=kubernetes)](https://kubernetes.io)
[![Biome](https://img.shields.io/badge/Linter-Biome_Strict-60a5fa?logo=biome)](https://biomejs.dev)

Serviço financeiro distribuído de alto desempenho e missão crítica para processamento de transações de apostas (`BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`) provenientes de múltiplos provedores de jogos de azar. Construído sob **Arquitetura Hexagonal pura**, idempotência persistente com hash canônico SHA-256, razão contábil imutável (*append-only ledger*), Transactional Outbox com leases temporais, Transactional Inbox com deduplicação atômica, rastreamento distribuído OpenTelemetry/Datadog APM e garantia matemática de integridade financeira sob concorrência feroz e tolerância a falhas.

- **Enunciado oficial do desafio:** [docs/challenge/CHALLENGE.md](docs/challenge/CHALLENGE.md)
- **Plano de fases e status (100% concluído):** [docs/ROADMAP.md](docs/ROADMAP.md)
- **Arquitetura detalhada e trade-offs:** [ARCHITECTURE.md](ARCHITECTURE.md) · [Diagrama Entidade-Relacionamento](docs/diagrams/er-diagram.md)
- **Decisões arquiteturais:** [ADRs (0001 a 0027)](docs/adr/README.md) · [RFCs (RFC-0001 a RFC-0012)](docs/rfc/README.md) · [Runbooks Operacionais](docs/runbooks/README.md)

---

## Invariantes Financeiras e Garantias no Schema (Regras Inegociáveis)

O sistema foi desenhado sob o princípio de **defesa em profundidade**: todas as regras contábeis fundamentais são aplicadas tanto na camada de domínio puro quanto no schema do PostgreSQL através de chaves compostas, triggers PL/pgSQL e constraints estritas:

| Invariante Contábil | Mecanismo de Garantia no Schema PostgreSQL | Decisão / RFC |
|---|---|---|
| **Zero Float para Dinheiro** | Domínio usa Value Object `Money` com `bigint` em centavos (escala fixa 2). Banco usa `NUMERIC(19,2)`. Contratos JSON usam string decimal (`"100.00"`). | [ADR-0007](docs/adr/0007-representar-money-com-bigint-no-dominio-e-numeric-no-banco.md) |
| **Saldo Jamais Negativo** | `CHECK (balance >= 0)` em `wallets`. Tentativa de saldo negativo é rejeitada atomicamente com código de falha `INSUFFICIENT_FUNDS`. | [ADR-0009](docs/adr/0009-garantir-invariantes-financeiras-no-schema-postgres.md) |
| **Ledger Append-Only Imutável** | Trigger `trg_wallet_ledger_entries__immutable` bloqueia qualquer `UPDATE` ou `DELETE` em `wallet_ledger_entries`. O razão é estritamente de inserção. | [ADR-0009](docs/adr/0009-garantir-invariantes-financeiras-no-schema-postgres.md) |
| **Aritmética Contábil Balanceada** | `CHECK (balance_after = balance_before + amount)` para `CREDIT` e `CHECK (balance_after = balance_before - amount)` para `DEBIT` em cada entrada do razão. | [ADR-0009](docs/adr/0009-garantir-invariantes-financeiras-no-schema-postgres.md) |
| **Lock Granular por Carteira** | Concorrência serializada por `walletId` via `SELECT ... FROM wallets WHERE id = $1 FOR UPDATE` com `SET LOCAL lock_timeout`. Zero lock global. | [ADR-0011](docs/adr/0011-usar-lock-pessimista-por-wallet-com-defesa-em-profundidade.md) |
| **Idempotência Persistente** | Unique constraint em `(provider_id, external_transaction_id)` e `(provider_id, idempotency_key)`. Replay com mesmo payload retorna HTTP `200` com `idempotentReplay: true`. Divergência de payload retorna HTTP `409 Conflict`. | [ADR-0012](docs/adr/0012-garantir-idempotencia-persistente-e-hash-canonico-sha256.md) |
| **Reversão Única Estrita** | Partial unique index `uq_wager_transactions__single_reversal` garante que uma aposta (`BET`) só possa sofrer **no máximo uma reversão efetiva** (`REFUND` ou `ROLLBACK`), impedindo crédito duplo. | [ADR-0014](docs/adr/0014-aplicar-politica-de-reversao-unica-e-validacao-de-referencia.md) |
| **Consistência Atômica Total** | Carteira, transação, razão contábil, inbox do SQS e eventos da Transactional Outbox participam **da mesma transação ACID SQL**. | [ADR-0003](docs/adr/0003-usar-mikroorm-com-entity-schema-sem-decorators-no-dominio.md) · [ADR-0017](docs/adr/0017-publicar-outbox-com-for-update-skip-locked-e-lease.md) |

---

## Arquitetura de Alto Nível

```
                      ┌──────────────────────────────────────────────────────────┐
                      │                   INBOUND INTERFACES                     │
                      │  • HTTP REST Gateway (/api/v1)                           │
                      │  • SQS FIFO Consumer (wager-transactions.fifo)           │
                      └─────────────┬──────────────────────────────┬─────────────┘
                                    │                              │
                                    ▼                              ▼
                      ┌──────────────────────────────────────────────────────────┐
                      │              APPLICATION USE CASES LAYER                 │
                      │  • ProcessWagerTransactionUseCase                        │
                      │  • OpenWalletUseCase / GetWalletUseCase                  │
                      │  • ListWalletLedgerUseCase (Keyset Cursor Pagination)    │
                      │  • ReconcileWalletUseCase (balance == sum(ledger))       │
                      └─────────────────────────────┬────────────────────────────┘
                                                    │
                                                    ▼
                      ┌──────────────────────────────────────────────────────────┐
                      │                  PURE DOMAIN ENGINE                      │
                      │  • Money VO (BigInt, Scale 2)                            │
                      │  • Wallet Aggregate (versioning & balance guards)        │
                      │  • WagerTransaction (Declarative State Machine)          │
                      │  • WalletLedgerEntry (Immutable append-only entry)       │
                      └─────────────────────────────┬────────────────────────────┘
                                                    │
                                                    ▼
                      ┌──────────────────────────────────────────────────────────┐
                      │          PERSISTENCE & OUTBOUND INFRASTRUCTURE           │
                      │  • PostgreSQL 17 ACID Unit of Work                       │
                      │    - SELECT FOR UPDATE on Wallet line                    │
                      │    - Outbox Messages + Inbox Messages                    │
                      │  • Transactional Outbox Publisher (SKIP LOCKED + Lease)  │
                      │  • SQS FIFO Events Queue (wallet-events.fifo)            │
                      │  • Audit Trail Adapter (In-Memory Ring Buffer + Parquet) │
                      │  • Prometheus Metrics Registry & OTel W3C Tracing        │
                      └──────────────────────────────────────────────────────────┘
```

---

## Pré-requisitos

- **Bun** `>= 1.2` ([Instalação do Bun](https://bun.sh))
- **Docker** e **Docker Compose**
- **Terraform** `>= 1.9` (para provisionamento opcional da infraestrutura AWS/EKS de produção)

---

## Setup Rápido (Ambiente Local)

```bash
# 1. Instalar dependências
bun install

# 2. Subir PostgreSQL 17 (porta 5433) e MiniStack SQS (porta 4567)
docker compose up -d postgres ministack

# 3. Executar migrations do banco de dados no PostgreSQL
bun run db:migrate:up

# 4. Iniciar a aplicação localmente (todos os papéis: api, consumer, outbox, scheduler)
bun run dev
```

A API estará respondendo em `http://localhost:3000`.

- **Documentação Pública ReDoc (3 colunas, padrão Redocly/Stripe):** [`http://localhost:3000/docs`](http://localhost:3000/docs)
- **Documentação Operacional Swagger UI (interativa):** [`http://localhost:3000/docs/swagger`](http://localhost:3000/docs/swagger)
- **Métricas Prometheus:** [`http://localhost:3000/metrics`](http://localhost:3000/metrics)
- **Health Checks:** [`http://localhost:3000/health/live`](http://localhost:3000/health/live) e [`http://localhost:3000/health/ready`](http://localhost:3000/health/ready)

---

## Scripts e Pirâmide de Testes

O projeto segue rigorosamente o princípio de **zero mocks em testes de integração e concorrência**: todos os testes executam contra instâncias reais do PostgreSQL 17 e do MiniStack SQS em contêineres Docker.

| Comando | Descrição | Cobertura |
|---|---|---|
| `bun run dev` | Inicia a aplicação com hot-reload (`APP_ROLE=all`) | Desenvolvimento local |
| `bun run start` | Inicia a aplicação compilada standalone | Produção / Contêiner |
| `bun run typecheck` | Verificação estrita de tipagem TypeScript (`tsc --noEmit`) | 0 erros em 160 arquivos |
| `bun run lint` | Validação de estilo e regras com Biome | 0 erros em 160 arquivos |
| `bun run format` | Auto-formatação e organização de imports com Biome | Formatação automática |
| `bun run test:unit` | Executa os testes unitários de domínio puro, VOs e guardrails arquiteturais | **80 testes unitários** |
| `bun run test:integration` | Executa testes de integração contra PostgreSQL 17 e SQS reais | **27 testes de integração** |
| `bun run test:e2e` | Executa testes End-to-End da API HTTP contra servidor NestJS real | **3 testes E2E** |
| `bun run test:concurrency` | Executa os **8 cenários obrigatórios de concorrência** com $\ge 3$ nós reais | **8 cenários de concorrência** |
| `bun run test:all` | **Executa todas as suítes de testes sequencialmente (unit, integration, e2e, concurrency)** | **118 testes automatizados** |
| `bun run test:load` | **Executa o benchmark de carga com percentis de latência ($p50$, $p95$, $p99$)** | **~1.500+ RPS** |
| `bun run db:migrate:up` | Aplica todas as migrations pendentes no PostgreSQL | Migrations versionadas |
| `bun run db:migrate:down` | Reverte a última migration aplicada no PostgreSQL | Reversibilidade garantida |
| `bun run db:migrate:status` | Exibe o status atual das migrations | Diagnóstico de schema |

---

## Matriz dos 8 Cenários de Concorrência Obrigatórios (Seção 13 do Desafio)

Executada via `bun test:concurrency` em `test/concurrency/mandatory-8-scenarios.spec.ts` com **3 instâncias simultâneas do NestJS** (`instance-1`, `instance-2`, `instance-3`) conectadas a banco PostgreSQL 17 e filas SQS reais:

| # | Cenário da Seção 13 | Comportamento sob Teste Concorrente | Resultado Verificado |
|---|---|---|---|
| **1 & 4** | **Aposta Idêntica 50× em Paralelo** | 50 requisições idênticas com mesmo `(providerId, externalTransactionId)` disparadas simultaneamente distribuídas nas 3 instâncias. | **Exatamente 1 débito efetuado (HTTP 201)**, 49 replays idempotentes (HTTP 200), saldo consistente, 1 entrada no ledger. |
| **2** | **Disputa Feroz de Saldo (*Hot Wallet*)** | Carteira com saldo 100.00 recebe 2 apostas paralelas de 80.00; em seguida, burst de 20 apostas simultâneas de 10.00 em saldo 100.00. | Em 100/80/80: 1 processada e 1 rejeitada com `INSUFFICIENT_FUNDS` (saldo final 20.00). Em 20×10.00: exatamente 10 aceitas e 10 rejeitadas (saldo final 0.00). **Zero saldo negativo**. |
| **3** | **Paralelismo Real sem Lock Global** | 15 carteiras distintas processadas em paralelo simultaneamente pelas 3 instâncias. | Todas as 15 carteiras processadas sem bloqueio mútuo e sem degradação de contenção. O lock ocorre na linha da carteira (`walletId`), não no banco. |
| **5** | **Crash de Worker entre Commit e ACK do SQS** | Mensagem de aposta processada e commitada no PostgreSQL, mas o processo morre antes de enviar o `DeleteMessage` para o SQS. | SQS redelivery ocorre após Visibility Timeout; o novo nó detecta a transação em `inbox_messages`, executa o ACK com deduplicação e **não duplica o débito**. |
| **6** | **Múltiplos Publishers de Outbox Concorrentes** | 3 workers de outbox disputando eventos em paralelo no banco de dados. | `FOR UPDATE SKIP LOCKED` com lease temporal garante que cada mensagem seja publicada **exatamente uma vez** na fila `wallet-events.fifo` sem colisão ou bloqueio. |
| **7** | **Reversão Fora de Ordem (`ROLLBACK` antes de `BET`)** | Mensagem de `ROLLBACK` ou `REFUND` chega ao sistema antes da aposta `BET` correspondente ser processada. | Transação é colocada em `PENDING_REFERENCE` (HTTP 202); assim que o `BET` correspondente é persistido, o `PendingReferenceWorker` resolve a reversão automaticamente. |
| **8** | **Reinício de Serviço com Trabalho Pendente** | Serviço é reiniciado abruptamente enquanto mensagens estão na fila SQS e eventos pendentes na Outbox. | O nó substituto inicializa, drena as filas e publica a outbox. Verificação formal prova que em todas as carteiras: $\text{balance} == \sum(\text{ledger})$. |

---

## Exemplos da API HTTP REST (`/api/v1`)

### 1. Criar Carteira para o Jogador

```bash
curl -X POST http://localhost:3000/api/v1/wallets \
  -H "Content-Type: application/json" \
  -H "X-Provider-Id: evolution" \
  -d '{
    "playerId": "11111111-1111-7111-8111-111111111111",
    "initialBalance": {
      "amount": "100.00",
      "currency": "BRL"
    }
  }'
```

**Resposta (`HTTP 201 Created`):**
```json
{
  "id": "018f3a21-9999-7000-8000-000000000001",
  "playerId": "11111111-1111-7111-8111-111111111111",
  "balance": {
    "amount": "100.00",
    "currency": "BRL"
  },
  "version": 1,
  "status": "ACTIVE",
  "createdAt": "2026-10-23T20:00:00.000Z",
  "updatedAt": "2026-10-23T20:00:00.000Z"
}
```

---

### 2. Processar uma Aposta (`BET`)

```bash
curl -X POST http://localhost:3000/api/v1/wagering/transactions \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: evo-tx-100" \
  -H "X-Provider-Id: evolution" \
  -d '{
    "providerId": "evolution",
    "externalTransactionId": "evo-tx-100",
    "playerId": "11111111-1111-7111-8111-111111111111",
    "walletId": "018f3a21-9999-7000-8000-000000000001",
    "roundId": "round-88",
    "gameId": "roulette-vip",
    "kind": "BET",
    "money": {
      "amount": "25.00",
      "currency": "BRL"
    }
  }'
```

**Resposta (`HTTP 201 Created`):**
```json
{
  "transactionId": "018f3a21-aaaa-7000-8000-000000000002",
  "status": "PROCESSED",
  "balance": {
    "amount": "75.00",
    "currency": "BRL"
  },
  "walletVersion": 2,
  "idempotentReplay": false
}
```

> **Comportamento de Replay Idempotente:** Se a mesma requisição for reenviada com os mesmos parâmetros e chave de idempotência, o sistema retorna `HTTP 200 OK` com `idempotentReplay: true`, retornando o saldo gravado no momento da aposta original sem realizar novo débito.

---

### 3. Processar uma Vitória (`WIN`) ou Perda (`LOSS`)

```bash
curl -X POST http://localhost:3000/api/v1/wagering/transactions \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: evo-tx-101" \
  -H "X-Provider-Id: evolution" \
  -d '{
    "providerId": "evolution",
    "externalTransactionId": "evo-tx-101",
    "playerId": "11111111-1111-7111-8111-111111111111",
    "walletId": "018f3a21-9999-7000-8000-000000000001",
    "roundId": "round-88",
    "gameId": "roulette-vip",
    "kind": "WIN",
    "money": {
      "amount": "50.00",
      "currency": "BRL"
    }
  }'
```

> **Nota contábil sobre `LOSS`:** Transações do tipo `LOSS` (montante 0.00) afetam o status da rodada e são persistidas para auditoria com status `PROCESSED`, porém **não geram entradas no razão** contábil de acordo com o design financeiro de dupla entrada.

---

### 4. Processar uma Reversão (`ROLLBACK`) ou Estorno (`REFUND`)

```bash
curl -X POST http://localhost:3000/api/v1/wagering/transactions \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: evo-tx-102" \
  -H "X-Provider-Id: evolution" \
  -d '{
    "providerId": "evolution",
    "externalTransactionId": "evo-tx-102",
    "playerId": "11111111-1111-7111-8111-111111111111",
    "walletId": "018f3a21-9999-7000-8000-000000000001",
    "roundId": "round-88",
    "gameId": "roulette-vip",
    "kind": "ROLLBACK",
    "money": {
      "amount": "25.00",
      "currency": "BRL"
    },
    "referenceExternalTransactionId": "evo-tx-100"
  }'
```

---

### 5. Consultar o Razão Contábil com Paginação por Cursor Opaco

```bash
curl "http://localhost:3000/api/v1/wallets/018f3a21-9999-7000-8000-000000000001/ledger?limit=10"
```

**Resposta (`HTTP 200 OK`):**
```json
{
  "items": [
    {
      "id": "018f3a21-bbbb-7000-8000-000000000003",
      "walletId": "018f3a21-9999-7000-8000-000000000001",
      "transactionId": "018f3a21-aaaa-7000-8000-000000000002",
      "walletVersion": 2,
      "direction": "DEBIT",
      "amount": { "amount": "25.00", "currency": "BRL" },
      "balanceBefore": { "amount": "100.00", "currency": "BRL" },
      "balanceAfter": { "amount": "75.00", "currency": "BRL" },
      "occurredAt": "2026-10-23T20:05:00.000Z"
    }
  ],
  "nextCursor": "eyJsYXN0T2NjdXJyZWRBdCI6IjIwMjYtMTAtMjNUMjA6MDU6MDAuMDAwWiIsImxhc3RJZCI6IjAxOGYzYTIxLWJiYmItNzAwMC04MDAwLTAwMDAwMDAwMDAwMyJ9"
}
```

---

### 6. Executar Conciliação Contábil da Carteira

```bash
curl -X POST http://localhost:3000/api/v1/wallets/018f3a21-9999-7000-8000-000000000001/reconcile
```

**Resposta (`HTTP 200 OK`):**
```json
{
  "walletId": "018f3a21-9999-7000-8000-000000000001",
  "walletBalance": { "amount": "100.00", "currency": "BRL" },
  "ledgerReconstructedBalance": { "amount": "100.00", "currency": "BRL" },
  "consistent": true,
  "ledgerEntriesCount": 3,
  "divergence": null,
  "reconciledAt": "2026-10-23T20:10:00.000Z"
}
```

---

### 7. Consultar a Trilha de Auditoria Fiscalizatória em Tempo Real

```bash
curl "http://localhost:3000/api/v1/admin/audit?limit=20&providerId=evolution&statusCode=201"
```

**Resposta (`HTTP 200 OK`):**
```json
{
  "items": [
    {
      "id": "019488a0-9999-7000-8000-000000000099",
      "timestamp": "2026-10-23T20:05:00.120Z",
      "clientIp": "192.168.1.10",
      "providerId": "evolution",
      "method": "POST",
      "path": "/api/v1/wagering/transactions",
      "statusCode": 201,
      "durationMs": 14,
      "correlationId": "019488a0-8888-7000-8000-000000000088",
      "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
      "spanId": "00f067aa0ba902b7",
      "userAgent": "Evolution-Gateway/1.4",
      "walletId": "018f3a21-9999-7000-8000-000000000001"
    }
  ],
  "count": 1,
  "queryLimit": 20
}
```

---

## Observabilidade, Tracing Distribuído e Arquivamento em Parquet / Athena

1. **Rastreamento Distribuído OpenTelemetry & Datadog APM ([ADR-0027](docs/adr/0027-observabilidade-e-tracing-distribuido-com-opentelemetry-e-datadog.md)):**
   - Interceptor W3C Trace Context (`CorrelationIdInterceptor`) extrai e injeta cabeçalhos padrão `traceparent` (`00-<traceId>-<spanId>-<flags>`), vinculando requisições HTTP, workers assíncronos e eventos SQS.
   - Respostas HTTP incluem cabeçalhos de rastreamento: `x-correlation-id` e `x-trace-id`.
   - Logs estruturados em formato JSON sanitizam automaticamente qualquer informação financeira sensível (`money`, `balance`, `amount`, `initialBalance`), registrando apenas metadados técnicos e operacionais (`correlationId`, `traceId`, `spanId`, `walletId`, `providerId`, `event`).

2. **Arquivamento Frio em S3 Parquet e Consultas SQL no AWS Athena ([ADR-0026](docs/adr/0026-trilha-de-auditoria-fiscalizatoria-via-s3-parquet-athena-e-endpoint-administrativo.md)):**
   - A declaração de infraestrutura em [`infra/terraform/audit.tf`](infra/terraform/audit.tf) provisiona:
     - Bucket Amazon S3 corporativo (`distributed-wagering-audit-trail-<env>`) com ciclo de vida (transição para S3 Glacier após 90 dias e expiração em 5 anos).
     - Particionamento em formato colunar Apache Parquet por `year/month/day` com compressão Snappy.
     - AWS Glue Data Catalog e Workgroup do Amazon Athena para permitir auditorias fiscais regulatórias via SQL serverless com mínimo escaneamento de bytes e sem sobrecarregar o banco transacional PostgreSQL OLTP.

---

## Benchmark de Performance e Carga (`bun run test:load`)

O script autônomo [`src/interfaces/cli/load-test.ts`](src/interfaces/cli/load-test.ts) executa um teste de estresse realista disparando 300 requisições HTTP concorrentes sob paralelismo 25 contra uma mistura de carteiras distribuídas, carteiras sob alta contenção (*hot wallets*) e injeção deliberada de replays de idempotência:

```bash
bun run test:load
```

**Resultados Medidos em Execução Real:**
```json
{
  "totalRequests": 300,
  "concurrency": 25,
  "distributedWalletCount": 20,
  "durationSeconds": 0.192,
  "throughputRps": 1562.22,
  "latencyMs": {
    "p50": 1.33,
    "p95": 48.74,
    "p99": 77.41,
    "max": 97.08
  },
  "outcomes": {
    "processed201": 54,
    "replay200": 3,
    "rejected422": 0,
    "errors5xx": 0
  },
  "outbox": {
    "lagBeforeDrain": 128,
    "drainDurationMs": 159.63,
    "lagAfterDrain": 0
  },
  "reconciliation": {
    "totalWallets": 20,
    "consistentWallets": 20
  }
}
```

- **Throughput:** **~1.560 requisições por segundo (RPS)** em nó individual Bun.
- **Latências:** $p50 = 1.33\text{ ms}$, $p95 = 48.74\text{ ms}$, $p99 = 77.41\text{ ms}$, $\max = 97.08\text{ ms}$.
- **Confiabilidade:** **Zero erros 5xx**, 0 mutações fantasmas, **100% das 20 carteiras matematicamente consistentes** (`balance == sum(ledger)`).

---

## Topologia de Execução (`APP_ROLE`) e Infraestrutura Cloud-Native (AWS EKS & Helm)

A aplicação é empacotada como um monólito modular stateless, parametrizado em runtime pela variável de ambiente `APP_ROLE`:

- `APP_ROLE=api`: Inicia apenas os controllers HTTP, interceptors, guards e endpoints de observabilidade.
- `APP_ROLE=consumer`: Inicia o consumidor da fila SQS FIFO (`wager-transactions.fifo`) com inbox transacional.
- `APP_ROLE=outbox`: Inicia o publisher da Transactional Outbox com `FOR UPDATE SKIP LOCKED` e lease temporal.
- `APP_ROLE=scheduler`: Inicia o worker assíncrono de reconciliação de transações fora de ordem (`PENDING_REFERENCE`).
- `APP_ROLE=all`: Inicia todos os papéis no mesmo processo (perfil padrão para desenvolvimento local).

### Infraestrutura como Código (Terraform) e Kubernetes Helm Chart

O diretório [`infra/terraform/`](infra/terraform/) contém a declaração de infraestrutura pronta para produção na AWS:
- **Amazon EKS (Kubernetes 1.31) + Helm Chart** ([`infra/helm/distributed-wagering-processor/`](infra/helm/distributed-wagering-processor/)):
  - Pods segregados por função (`api`, `consumer`, `outbox`, `scheduler`).
  - HPA baseado em CPU/Tráfego para os Pods da API (2 a 20 réplicas).
  - KEDA `ScaledObject` escalando os Pods do Consumer dinamicamente conforme a profundidade da fila SQS (2 a 30 réplicas).
- **Rede & Banco de Dados:** VPC Multi-AZ com sub-redes privadas e Amazon RDS PostgreSQL 17 protegido por **AWS RDS Proxy** (multiplexação de conexões para absorver picos de auto-scaling sem saturar o banco).
- **Segurança e Menor Privilégio:** IAM Roles for Service Accounts (IRSA) granulares por Pod, criptografia KMS CMK em repouso e políticas restritivas.

---

## Índice Completo de Decisões Arquiteturais (ADRs 0001 a 0027)

Todas as decisões arquiteturais do projeto são registradas formalmente no formato MADR em [`docs/adr/`](docs/adr/):

| ADR | Título | Status |
|---|---|---|
| [ADR-0001](docs/adr/0001-registrar-decisoes-arquiteturais.md) | Registrar decisões arquiteturais com formato MADR em PT-BR | Accepted |
| [ADR-0002](docs/adr/0002-adotar-stack-base-bun-typescript-nestjs-postgres.md) | Adotar stack base: Bun, TypeScript strict, NestJS 11 e PostgreSQL 17 | Accepted |
| [ADR-0003](docs/adr/0003-usar-mikroorm-com-entity-schema-sem-decorators-no-dominio.md) | Usar MikroORM v6 com EntitySchema desacoplado do domínio | Accepted |
| [ADR-0004](docs/adr/0004-gerar-identificadores-com-uuidv7-na-aplicacao.md) | Gerar identificadores UUIDv7 ordenáveis temporalmente na aplicação | Accepted |
| [ADR-0005](docs/adr/0005-adotar-ministack-como-emulador-sqs-padrao.md) | Adotar MiniStack como emulador SQS padrão com suporte a LocalStack | Accepted |
| [ADR-0006](docs/adr/0006-estruturar-topologia-em-modular-monolith-por-papeis.md) | Estruturar topologia em monólito modular parametrizado por `APP_ROLE` | Accepted |
| [ADR-0007](docs/adr/0007-representar-money-com-bigint-no-dominio-e-numeric-no-banco.md) | Representar Money com bigint no domínio e NUMERIC(19,2) no PostgreSQL | Accepted |
| [ADR-0008](docs/adr/0008-modelar-enums-no-postgres-com-text-e-check-constraints.md) | Modelar enums no PostgreSQL com colunas TEXT e CHECK constraints | Accepted |
| [ADR-0009](docs/adr/0009-garantir-invariantes-financeiras-no-schema-postgres.md) | Garantir invariantes financeiras no schema PostgreSQL com constraints e triggers | Accepted |
| [ADR-0010](docs/adr/0010-maquina-de-estados-e-politicas-declarativas-no-dominio.md) | Máquina de estados e políticas declarativas no domínio puro | Accepted |
| [ADR-0011](docs/adr/0011-usar-lock-pessimista-por-wallet-com-defesa-em-profundidade.md) | Usar lock pessimista por carteira (`SELECT FOR UPDATE`) com lock timeout | Accepted |
| [ADR-0012](docs/adr/0012-garantir-idempotencia-persistente-e-hash-canonico-sha256.md) | Garantir idempotência persistente no banco e hash canônico SHA-256 | Accepted |
| [ADR-0013](docs/adr/0013-definir-taxonomia-de-failure-codes-e-mapeamento-http.md) | Definir taxonomia estável de failure codes e mapeamento declarativo HTTP/SQS | Accepted |
| [ADR-0014](docs/adr/0014-aplicar-politica-de-reversao-unica-e-validacao-de-referencia.md) | Aplicar política de reversão única por transação referenciada | Accepted |
| [ADR-0015](docs/adr/0015-paginacao-do-ledger-por-cursor-opaco-keyset.md) | Paginação do razão contábil por cursor opaco keyset (`created_at, id`) | Accepted |
| [ADR-0016](docs/adr/0016-classificar-falhas-no-consumer-sqs-com-inbox-dlq-e-graceful-shutdown.md) | Classificar falhas no consumer SQS com Inbox transacional, DLQ e graceful shutdown | Accepted |
| [ADR-0017](docs/adr/0017-publicar-outbox-com-for-update-skip-locked-e-lease.md) | Publicar eventos da Transactional Outbox com `FOR UPDATE SKIP LOCKED` e lease temporal | Accepted |
| [ADR-0018](docs/adr/0018-resolver-referencias-pendentes-com-backoff-exponencial-e-ttl.md) | Resolver referências pendentes com backoff exponencial e limite de tentativas | Accepted |
| [ADR-0019](docs/adr/0019-expor-metricas-prometheus-e-logs-estruturados-sem-dados-sensiveis.md) | Expor métricas Prometheus e logs estruturados sem dados financeiros sensíveis | Accepted |
| [ADR-0020](docs/adr/0020-ponto-de-extensao-auth-oidc-e-infraestrutura-terraform-autoscaling.md) | Ponto de extensão de autenticação OIDC e infraestrutura Terraform com auto-scaling | Accepted |
| [ADR-0021](docs/adr/0021-testar-concorrencia-e-recuperacao-com-multiplas-instancias-e-infra-real.md) | Testar concorrência e recuperação pós-crash com múltiplas instâncias e infraestrutura real | Accepted |
| [ADR-0022](docs/adr/0022-mitigacao-owasp-api-security-e-rate-limiting.md) | Mitigações OWASP API Security, rate limiting sliding-window e security headers | Accepted |
| [ADR-0023](docs/adr/0023-adotar-prefixo-api-v1-e-documentacao-dual-redoc-swagger.md) | Adotar prefixo `/api/v1` com documentação dual ReDoc e Swagger UI | Accepted |
| [ADR-0024](docs/adr/0024-incluir-diagramas-de-fluxo-na-documentacao-openapi.md) | Incluir diagramas de fluxo de sequência na documentação OpenAPI | Accepted |
| [ADR-0025](docs/adr/0025-auto-merge-dependabot-para-atualizacoes-seguras-sem-impacto-em-fluxo.md) | Auto-merge seguro do Dependabot para atualizações de dependências | Accepted |
| [ADR-0026](docs/adr/0026-trilha-de-auditoria-fiscalizatoria-via-s3-parquet-athena-e-endpoint-administrativo.md) | Trilha de auditoria fiscalizatória via S3 Parquet, Athena e endpoint administrativo | Accepted |
| [ADR-0027](docs/adr/0027-observabilidade-e-tracing-distribuido-com-opentelemetry-e-datadog.md) | Observabilidade e tracing distribuído com padrão OpenTelemetry e Datadog APM | Accepted |

---

## Índice de RFCs de Engenharia (RFC-0001 a RFC-0012)

Todas as fases de desenvolvimento foram desenhadas antecipadamente via RFCs detalhadas em [`docs/rfc/`](docs/rfc/):

- [RFC-0001 — Stack tecnológica, scaffolding hexagonal e topologia de execução](docs/rfc/RFC-0001-stack-scaffolding-e-topologia.md)
- [RFC-0002 — Modelagem de dados, design de relacionamentos e invariantes no schema PostgreSQL](docs/rfc/RFC-0002-modelagem-de-dados-e-relacionamentos.md)
- [RFC-0003 — Modelo de domínio puro, políticas declarativas e máquina de estados](docs/rfc/RFC-0003-modelo-de-dominio-e-maquina-de-estados.md)
- [RFC-0004 — Pipeline de processamento transacional, controle de concorrência por carteira e idempotência persistente](docs/rfc/RFC-0004-pipeline-de-processamento-concorrencia-e-idempotencia.md)
- [RFC-0005 — API HTTP REST, validação de contratos com Zod, filtro declarativo de erros e paginação por cursor](docs/rfc/RFC-0005-api-http-validacao-e-tratamento-de-erros.md)
- [RFC-0006 — Consumidor SQS FIFO com Inbox persistente, classificação declarativa de falhas, DLQ e graceful shutdown](docs/rfc/RFC-0006-consumer-sqs-inbox-dlq-e-shutdown.md)
- [RFC-0007 — Transactional Outbox Publisher concorrente com lease e resolução assíncrona de referências pendentes](docs/rfc/RFC-0007-transactional-outbox-e-workers-assincronos.md)
- [RFC-0008 — Observabilidade com métricas Prometheus, logs JSON estruturados e health checks](docs/rfc/RFC-0008-observabilidade-metricas-logs-e-health.md)
- [RFC-0009 — Suíte completa de concorrência multi-instância (8 cenários da Seção 13) e benchmark de carga](docs/rfc/RFC-0009-suite-concorrencia-multi-instancia-e-teste-de-carga.md)
- [RFC-0010 — Padronização de rotas RESTful com prefixo /api/v1 e documentação dual ReDoc e Swagger UI](docs/rfc/RFC-0010-padronizacao-rotas-api-v1-e-documentacao-dual-redoc-swagger.md)
- [RFC-0011 — Diagramas de fluxo e sequência na documentação OpenAPI (ReDoc & Swagger)](docs/rfc/RFC-0011-diagramas-de-fluxo-na-documentacao-openapi.md)
- [RFC-0012 — Trilha de auditoria fiscalizatória em Parquet/Athena e observabilidade unificada com OpenTelemetry e Datadog](docs/rfc/RFC-0012-trilha-de-auditoria-fiscalizatoria-e-observabilidade-opentelemetry-datadog.md)
