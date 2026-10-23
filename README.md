# Distributed Wagering Processor

Serviço financeiro distribuído de alto desempenho e missão crítica para processamento de transações de apostas (`BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`) provenientes de múltiplos provedores de jogos. Construído em **Arquitetura Hexagonal pura**, com idempotência persistente, ledger imutável append-only, Transactional Outbox, Transactional Inbox, métricas Prometheus e correção contábil garantida sob concorrência feroz e falhas de infraestrutura.

- **Enunciado oficial:** [docs/challenge/CHALLENGE.md](docs/challenge/CHALLENGE.md)
- **Plano de fases e status:** [docs/ROADMAP.md](docs/ROADMAP.md)
- **Arquitetura viva:** [ARCHITECTURE.md](ARCHITECTURE.md) · [Diagrama ER](docs/diagrams/er-diagram.md)
- **Decisões arquiteturais:** [ADRs (0001 a 0022)](docs/adr/README.md) · [RFCs (RFC-0001 a RFC-0009)](docs/rfc/README.md) · [Runbooks Operacionais](docs/runbooks/README.md)


---

## Pré-requisitos

- **Bun** `>= 1.2`
- **Docker** e **Docker Compose**
- **Terraform** `>= 1.9` (para provisionamento de infraestrutura AWS em produção)

---

## Setup Rápido (Ambiente de Desenvolvimento)

```bash
# 1. Instalar dependências
bun install

# 2. Subir PostgreSQL 17 (porta 5433) e MiniStack SQS (porta 4567)
docker compose up -d postgres ministack

# 3. Executar migrations do banco de dados
bun run db:migrate:up

# 4. Iniciar a aplicação localmente (todos os papéis: api, consumer, outbox, scheduler)
bun run dev
```

A API estará disponível em `http://localhost:3000`.
Acesse a **Documentação Interativa (OpenAPI/Swagger Web View)** em: `http://localhost:3000/docs`.


---

## Scripts e Suítes de Testes

O projeto segue a regra de **zero mocks em testes de integração e concorrência**: todos os testes executam contra instâncias reais de PostgreSQL 17 e MiniStack SQS.

| Comando | Descrição |
|---|---|
| `bun run dev` | Inicia a aplicação com hot-reload (`APP_ROLE=all`) |
| `bun run start` | Inicia a aplicação em modo standalone |
| `bun run typecheck` | Verificação estrita de tipagem TypeScript (`tsc --noEmit`) |
| `bun run lint` | Validação de estilo e regras com Biome |
| `bun run format` | Auto-formatação e organização de imports com Biome |
| `bun run test:unit` | Executa os 35 testes unitários de domínio e arquitetura |
| `bun run test:integration` | Executa os 27 testes de integração (schema PostgreSQL, use cases, SQS, Outbox) |
| `bun run test:e2e` | Executa os testes End-to-End da API HTTP contra servidor real |
| `bun run test:concurrency` | Executa os 8 cenários obrigatórios de concorrência com 3 instâncias reais |
| `bun run test:all` | **Executa todas as 73 suítes de testes sequencialmente (unit, integration, e2e, concurrency)** |
| `bun run test:load` | **Executa o benchmark de carga com percentis de latência ($p50$, $p95$, $p99$)** |
| `bun run db:migrate:up` | Executa migrations pendentes no PostgreSQL |
| `bun run db:migrate:down` | Reverte a última migration aplicada no PostgreSQL |
| `bun run db:migrate:status` | Exibe o status das migrations |

---

## Exemplos da API HTTP

### 1. Criar Carteira para o Jogador

```bash
curl -X POST http://localhost:3000/wallets \
  -H "Content-Type: application/json" \
  -d '{
    "playerId": "11111111-1111-7111-8111-111111111111",
    "initialBalance": {
      "amount": "100.00",
      "currency": "BRL"
    }
  }'
```

**Resposta (HTTP 201 Created):**
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
  "createdAt": "2026-10-22T21:00:00.000Z",
  "updatedAt": "2026-10-22T21:00:00.000Z"
}
```

---

### 2. Processar uma Aposta (`BET`)

```bash
curl -X POST http://localhost:3000/wagering/transactions \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: prov-1:tx-100" \
  -d '{
    "providerId": "prov-1",
    "externalTransactionId": "tx-100",
    "playerId": "11111111-1111-7111-8111-111111111111",
    "walletId": "018f3a21-9999-7000-8000-000000000001",
    "roundId": "round-42",
    "gameId": "fortune-chimp",
    "kind": "BET",
    "money": {
      "amount": "25.00",
      "currency": "BRL"
    }
  }'
```

**Resposta (HTTP 201 Created):**
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

*(Se a mesma requisição for reenviada com os mesmos parâmetros, a resposta retorna `HTTP 200 OK` com `idempotentReplay: true` e o saldo não é debitado novamente).*

---

### 3. Processar uma Reversão (`ROLLBACK`) ou Estorno (`REFUND`)

```bash
curl -X POST http://localhost:3000/wagering/transactions \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: prov-1:tx-rb-100" \
  -d '{
    "providerId": "prov-1",
    "externalTransactionId": "tx-rb-100",
    "playerId": "11111111-1111-7111-8111-111111111111",
    "walletId": "018f3a21-9999-7000-8000-000000000001",
    "roundId": "round-42",
    "gameId": "fortune-chimp",
    "kind": "ROLLBACK",
    "money": {
      "amount": "25.00",
      "currency": "BRL"
    },
    "referenceExternalTransactionId": "tx-100"
  }'
```

---

### 4. Consultar o Razão Contábil (Ledger) com Paginação por Cursor Opaco

```bash
curl "http://localhost:3000/wallets/018f3a21-9999-7000-8000-000000000001/ledger?limit=10"
```

**Resposta (HTTP 200 OK):**
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
      "occurredAt": "2026-10-22T21:05:00.000Z"
    }
  ],
  "nextCursor": "eyJsYXN0T2NjdXJyZWRBdCI6IjIwMjYtMTAtMjJUMjE6MDU6MDAuMDAwWiIsImxhc3RJZCI6IjAxOGYzYTIxLWJiYmItNzAwMC04MDAwLTAwMDAwMDAwMDAwMyJ9"
}
```

---

### 5. Executar Conciliação Contábil da Carteira

```bash
curl -X POST http://localhost:3000/wallets/018f3a21-9999-7000-8000-000000000001/reconcile
```

**Resposta (HTTP 200 OK):**
```json
{
  "walletId": "018f3a21-9999-7000-8000-000000000001",
  "walletBalance": { "amount": "100.00", "currency": "BRL" },
  "ledgerReconstructedBalance": { "amount": "100.00", "currency": "BRL" },
  "consistent": true,
  "ledgerEntriesCount": 3,
  "divergence": null,
  "reconciledAt": "2026-10-22T21:10:00.000Z"
}
```

---

### 6. Observabilidade e Health Checks

- **Métricas Prometheus:** `GET http://localhost:3000/metrics`
- **Liveness:** `GET http://localhost:3000/health/live`
- **Readiness:** `GET http://localhost:3000/health/ready`

---

## Topologia de Execução (`APP_ROLE`) e Auto-Scaling

A aplicação é empacotada como um monólito modular stateless, parametrizado pela variável de ambiente `APP_ROLE`:

- `APP_ROLE=api`: Inicia apenas os controllers HTTP e health checks.
- `APP_ROLE=consumer`: Inicia o consumidor de filas SQS FIFO (`wager-transactions.fifo`) com inbox transacional.
- `APP_ROLE=outbox`: Inicia o publisher de Transactional Outbox com `FOR UPDATE SKIP LOCKED` e lease temporal.
- `APP_ROLE=scheduler`: Inicia o worker assíncrono de resolução de transações fora de ordem (`PENDING_REFERENCE`).
- `APP_ROLE=all`: Inicia todos os papéis no mesmo processo (ideal para desenvolvimento local).

### Infraestrutura como Código (Terraform) e Kubernetes (EKS / Helm / ArgoCD)

O diretório [`infra/terraform/`](infra/terraform/) contém a declaração de infraestrutura corporativa pronta para produção na AWS:
- **Padrão `locals.tf` Centralizado:** Governança de nomenclatura corporativa, tags unificadas de FinOps/SecOps/Compliance e seleção dinâmica de AZs para agilidade multi-region (`var.aws_region`).
- **Segurança e Menor Privilégio (Least Privilege IAM):** IAM Roles estritamente segregadas por `APP_ROLE` (API sem acesso ao SQS; Consumer com acesso apenas à fila inbound e DLQ; Outbox apenas com envio na fila de eventos).
- **Criptografia e Segredos:** AWS KMS CMK dedicado com auto-rotação anual para criptografia em repouso do RDS, SQS, ECR e Secrets Manager, além de Envelope Encryption para Kubernetes Secrets no EKS.
- **Orquestração Cloud-Native com Amazon EKS 1.31 & Helm Chart** ([`infra/helm/`](infra/helm/)):
  - O Terraform ([`infra/terraform/helm_app.tf`](infra/terraform/helm_app.tf)) provisiona o cluster EKS e instala automaticamente o chart Helm, criando os Pods segregados por função (`api`, `consumer`, `outbox`, `scheduler`).
  - HPA baseado em CPU/Tráfego para a API.
  - KEDA `ScaledObject` para escalonamento horizontal instantâneo do Consumer baseado na profundidade da fila SQS (`ApproximateNumberOfMessagesVisible`).
  - **Cloud-Agnostic:** O chart Helm pode ser implantado identicamente em AWS EKS, Google Cloud GKE, Microsoft Azure AKS ou Kind local sem lock-in.
  - **Extensibilidade Futura:** Suporte nativo a `CronJob`s no Kubernetes para processos periódicos de consolidação e conciliação contábil batch.
- **GitOps & CI/CD Modular ([`.github/workflows/`](.github/workflows/)):**
  - **`ci.yaml`**: Integração contínua e pirâmide de testes disparada em PRs e feature branches (`feat/*`).
  - **`security-scan.yaml`**: Varredura de vulnerabilidades de dependências e contêiner via **Trivy** e geração de **SBOM (SPDX)**.
  - **`cd-dev.yaml`**: Deploy contínuo para o ambiente de Desenvolvimento (`develop`) via ArgoCD (`values-dev.yaml`).
  - **`cd-prod.yaml`**: Deploy contínuo para Produção (`main`) com assinatura criptográfica **Cosign (Sigstore)** e ArgoCD (`values-prod.yaml`).
- **Banco de Dados:** Amazon RDS PostgreSQL 17 Multi-AZ com AWS RDS Proxy para multiplexação de conexões.
- **Filas SQS:** Filas FIFO com DLQ e políticas de re-drive seguindo o padrão `<project>-<env>-<domain>-<purpose>[.fifo]`.
