---
rfc: RFC-0011
title: Diagramas de Fluxo e Sequência na Documentação OpenAPI (ReDoc & Swagger)
status: Accepted
author: Ulysses Andrade Leal
created: 2026-10-23
updated: 2026-10-23
phase: 14
adrs: [0024]
---

# RFC-0011 — Diagramas de Fluxo e Sequência na Documentação OpenAPI (ReDoc & Swagger)

## 1. Resumo

Este RFC define a padronização e inclusão de diagramas de fluxo arquitetural, sequências de transação ACID e máquinas de estado diretamente nas especificações OpenAPI (`PUBLIC_OPENAPI_SPECIFICATION` e `PRIVATE_OPENAPI_SPECIFICATION`) consumidas pelo **ReDoc** e **Swagger UI**. O objetivo é enriquecer a experiência do avaliador técnico e de desenvolvedores de provedores de jogos com explicações visuais de cada endpoint, demonstrando onde ocorrem as garantias financeiras críticas (locks pessimistas, idempotência persistente, append-only ledger, outbox transacional e resolução de referências pendentes).

## 2. Contexto e motivação

O desafio técnico exige a implementação rigorosa de regras financeiras distribuídas:
- **Seção 6 & 7 (Regras de Negócio e Transações):** `BET`, `WIN`, `LOSS`, `REFUND` e `ROLLBACK` possuem ciclos de vida distintos, garantias de concorrência e dependências referenciais.
- **Seção 8 (Concorrência):** Lock pessimista por `walletId` com serialização de saldo.
- **Seção 9 (Endpoints HTTP):** Documentação interativa e contratos de API.
- **Seção 10 (Idempotência):** Deduplicação persistente via unique constraint e hash canônico SHA-256.

Embora o código implemente todas as regras, a documentação OpenAPI gerada em ferramentas como ReDoc ganha alto valor avaliativo quando cada endpoint detalha visualmente o seu pipeline de execução (etapas de pré-validação, locks, persistência atômica e mensageria).

## 3. Objetivos e não-objetivos

**Objetivos**
- Incluir diagramas de sequência claros e padronizados no campo `description` de cada operação da API:
  - `POST /v1/api/wallets` (Criação de Carteira e Gênese do Ledger).
  - `GET /v1/api/wallets/{id}` (Consulta Otimizada de Saldo).
  - `GET /v1/api/wallets/{id}/ledger` (Paginação Keyset Determinística do Ledger).
  - `POST /v1/api/wagering/transactions` (Pipeline Financeiro Completo: Lock, Deduplicação, Débito/Crédito, Out-of-Order e Outbox).
  - `GET /v1/api/wagering/transactions/{id}` e `GET /v1/api/wagering/transactions/external/{providerId}/{externalTransactionId}` (Rastreamento por ID Interno e Externo).
  - `POST /v1/api/wallets/{id}/reconcile` (Auditoria e Reconciliação Contra o Ledger).
- Garantir que os diagramas renderizem com 100% de fidelidade visual em qualquer cliente (ReDoc, Swagger UI, Postman e visualizadores Markdown).
- Manter o código TypeScript limpo, tipado e livre de HTML manual.

**Não-objetivos**
- Alterar as regras de negócio de domínio ou schemas SQL existentes.
- Injetar dependências pesadas de compilação gráfica em tempo de execução.

## 4. Desenho proposto

### 4.1 Estratégia de Renderização e Information Hiding (Público vs. Privado)

Seguindo o princípio de **Information Hiding** e a skill `.agents/skills/document-api/SKILL.md`:
1. **Documentação Pública (`/v1/api/docs` — ReDoc):**
   - Apresenta uma visão **estritamente black-box** da plataforma para parceiros e provedores de jogos.
   - **Nunca** vaza queries SQL (`SELECT FOR UPDATE`), nomes de tabelas (`wager_tx`, `wallet_ledger_entries`), locks de banco ou mecanismos de workers assíncronos (`SKIP LOCKED`).
   - Foca nos contratos, garantias de concorrência, idempotência por chave canônica e transições de estado do negócio (`PROCESSED`, `PENDING_REFERENCE`).
2. **Documentação Privada & Operacional (`/v1/api/docs/swagger` — Swagger UI):**
   - Apresenta rotas de infraestrutura e governança técnica para SREs e avaliadores técnicos (`/wallets/:id/reconcile`, `/health/live`, `/health/ready`, `/metrics`).
   - Apresenta detalhes white-box de auditoria contábil e conciliação contra o histórico do ledger.
3. **Formato universal:** Diagramas de sequência arquiteturais em blocos monospaçados com caracteres Unicode estruturados (`┌───┐`, `│`, `▼`, `───>`), combinados com Mermaid no RFC/documentação.

### 4.2 Diagramas dos Principais Endpoints (Visão Black-Box do Parceiro)

#### 1. Abertura de Carteira (`POST /v1/api/wallets`)

```text
[Game Provider / Partner]         [Wagering API Gateway]          [Core Financial Ledger]
         │                                │                                │
         │─── POST /v1/api/wallets ──────>│                                │
         │    (playerId, currency,        │─── Validate Schema & Currency ─│
         │     initialBalance)            │                                │
         │                                │─── Genesis Opening Request ───>│
         │                                │    • Assert Player Uniqueness  │
         │                                │    • Initialize Zero-Balance   │
         │                                │    • Credit Opening Balance    │
         │                                │<── Wallet Opened (v1) ─────────│
         │<── 201 Created ────────────────│                                │
         │    {id, balance: "500.00"}     │                                │
```

#### 2. Processamento Financeiro (`POST /v1/api/wagering/transactions`)

```text
[Game Provider / Partner]         [Wagering API Gateway]          [Core Financial Engine]
         │                                │                                │
         │─── POST /transactions ────────>│                                │
         │    (Idempotency-Key,           │─── Rate Limit & Auth Check ────│
         │     kind: BET, amount)         │─── Canonical Signature Hash ───│
         │                                │                                │
         │                                │─── Check Idempotency Record ──>│
         │                                │<── [Hit]: Replay Result ───────│
         │<── 200 OK (Idempotent Replay) ─│    (If payload differs: 409)   │
         │                                │                                │
         │                                │─── [Miss]: Authorize & Settle ─>│
         │                                │    • Lock Wallet Concurrently  │
         │                                │    • Validate Funds & Currency │
         │                                │    • Mutate Balance Atomically │
         │                                │    • Append Immutable Ledger   │
         │                                │<── Transaction Finalized ──────│
         │<── 201 Created (PROCESSED) ────│                                │
         │    {id, balance, version: 2}   │                                │
```

#### 3. Reversão Fora de Ordem (`ROLLBACK` / `REFUND` antes da `BET`)

```text
[Game Provider / Partner]         [Wagering API Gateway]          [Core Financial Engine]
         │                                │                                │
         │─── POST tx (REFUND) ──────────>│                                │
         │    (ref: BET-EXT-99)           │─── Check Referenced Bet ──────>│
         │                                │<── Not Found (Arrived Early) ──│
         │                                │                                │
         │                                │─── Register Pending Reference ─>│
         │<── 202 Accepted ───────────────│                                │
         │    (status: PENDING_REFERENCE) │                                │
         │                                │    [Asynchronous Resolution]   │
         │                                │    When BET arrives, Engine    │
         │                                │    settles REFUND debit        │
         │                                │    automatically in background │
```
         │                           │── Salvar PENDING_REFERENCE ───>│                            │
         │<── 202 Accepted ──────────│                                │                            │
         │                           │                                │                            │
         │                           │                                │── Polling com Backoff ─────│
         │                           │                                │   BET-100 chegou? ─────────│
         │                           │                                │<── BET-100 PROCESSED ──────│
         │                           │                                │── Lock Wallet FOR UPDATE ──│
         │                           │                                │── Executa Reversão Ledger ─│
         │                           │                                │── Transiciona PROCESSED ──>│
         │                           │                                │── Enfileira Outbox Event ──│
```

#### 4. Auditoria e Reconciliação do Saldo (`POST /v1/api/wallets/{id}/reconcile`)

```text
[Operador / Auditor SRE]       [API Gateway]                [PostgreSQL Ledger]
         │                           │                                │
         │─── POST /reconcile ──────>│                                │
         │                           │── BEGIN TRANSACTION ──────────>│
         │                           │   SELECT wallet FOR UPDATE ────│ (Lock pessimista exclusivo)
         │                           │   SELECT SUM(ledger) ──────────│ (Reconstrói saldo histórico)
         │                           │   Compara: balance == ledger?  │
         │                           │   [Se divergente]:             │
         │                           │     UPDATE wallet = sum(ledger)│
         │                           │     INSERT audit ledger entry  │
         │                           │── COMMIT ─────────────────────>│
         │<── 200 OK ────────────────│                                │
         │    (ReconcileResponse)    │                                │
```

## 5. Invariantes e garantias

| Invariante | Onde é garantida | Como é testada |
|---|---|---|
| Saldo da carteira sempre igual à soma do ledger | Schema SQL (triggers/constraints) e reconciliação | `test:unit`, `test:integration` e `test:concurrency` |
| Lock pessimista por carteira | Infraestrutura (`FOR UPDATE` na `walletId`) | Cenários de concorrência com 50 transações paralelas |
| Deduplicação persistente de transações | Schema SQL (`UNIQUE(idempotency_key)`) + SHA-256 | Testes de unidade em `CanonicalPayloadHasher` e concorrência |
| Reversão única estrita | Domínio (`WagerTransaction`) e Schema (`UNIQUE(reference_transaction_id)`) | Testes de domínio e integração de tentativa de duplo refund |
| Outbox na mesma transação atômica | Repositório MikroORM / PostgreSQL | Verificação de transação única de persistência |

## 6. Modos de falha

| Falha | Comportamento esperado | Teste |
|---|---|---|
| Conflito de hash na chave de idempotência | Retorna 409 Conflict imediatamente | Teste de unidade e integração |
| Transação de reversão chega antes do débito | Registra `PENDING_REFERENCE` e retorna 202 Accepted | Cenário 13.8 de concorrência |
| Saldo insuficiente para débito de BET | Lança `InsufficientFundsError`, retorna 422 sem alterar saldo | Teste de unidade de `Wallet` |
| Divergência entre saldo e ledger | Reconciliação detecta, ajusta saldo e registra log de auditoria | Teste de auditoria em `reconcile` |

## 7. Alternativas consideradas

- **Injeção de script Mermaid dinâmico no ReDoc:** Descartada devido a problemas conhecidos de timing com o Virtual DOM do ReDoc e restrições de `script-src` sob CSP rigorosa.
- **Diagramas em imagens PNG/SVG externas via CDN:** Descartada para evitar dependências de rede externa e permitir documentação 100% autossuficiente e offline.
- **Diagramas estruturados monospaçados Unicode diretamente nas descrições OpenAPI:** Escolhida. Renderiza com zero latência, alta legibilidade e funciona idêntico no ReDoc, Swagger UI e exportações de especificação.

## 8. Observabilidade

- Os diagramas documentam os eventos semânticos emitidos pelo sistema:
  - `wallet.opened`
  - `wager.transaction.processed`
  - `wager.transaction.pending_reference`
  - `wager.transaction.rejected`
  - `wallet.reconciled`

## 9. Plano de testes

- **Unidade:** Verificar integridade das especificações OpenAPI em [test/unit/interfaces/docs-controller.spec.ts](test/unit/interfaces/docs-controller.spec.ts) e garantir que as descrições contenham os diagramas.
- **Arquitetura:** Assegurar zero comentários em arquivos `.ts` e path aliases `@`.
- **Visual:** Capturar screenshot headless do ReDoc e Swagger UI para validar a formatação correta dos diagramas.

## 10. Plano de implementação

- [x] Criar branch `feat/openapi-flow-diagrams`
- [x] Elaborar RFC-0011 e ADR-0024
- [ ] Atualizar [src/interfaces/http/docs.controller.ts](src/interfaces/http/docs.controller.ts) com os diagramas de fluxo em cada operação
- [ ] Executar testes de unidade, lint e typecheck
- [ ] Validar renderização visual via Chrome Headless
- [ ] Abrir PR para `develop`, merge, release v1.0.8 no `main`

## 11. Riscos e questões em aberto

- **Volume do arquivo OpenAPI:** O acréscimo de texto nos campos `description` aumenta ligeiramente o tamanho do JSON gerado (~5 KB), o que é irrelevante frente ao ganho de clareza e documentação do sistema.
