---
rfc: RFC-0005
title: API HTTP REST, validação de contratos com Zod, filtro declarativo de erros e paginação por cursor
status: Implemented
author: Ulysses Andrade Leal
created: 2026-10-22
updated: 2026-10-22
phase: 5
adrs: [ADR-0013, ADR-0015]
---

# RFC-0005 — API HTTP REST, validação de contratos com Zod, filtro declarativo de erros e paginação por cursor

## 1. Resumo

Especifica a camada de interface HTTP (`src/interfaces/http/`) do **Distributed Wagering Processor**, cobrindo todos os endpoints exigidos na Seção 9 do desafio: criação e consulta de carteiras, listagem paginada do ledger por cursor opaco, submissão síncrona de transações com header `Idempotency-Key` obrigatório, consulta de transações por ID interno e por `(providerId, externalTransactionId)`, reconciliação explícita de carteira e filtro global declarativo de exceções.

## 2. Motivação e escopo

A API HTTP é a porta de entrada síncrona dos provedores de jogos e das ferramentas de operação/auditoria. De acordo com a Seção 9 do desafio, a API deve distinguir com clareza — por meio de códigos HTTP determinísticos e corpos JSON estruturados — payload inválido (`400`), recurso inexistente (`404`), conflito de idempotência ou unicidade (`409`), rejeição por regra de negócio (`422`), aceite com dependência pendente (`202`), processamento inédito (`201`), replay idempotente (`200`) e falha transitória de infraestrutura (`503`).

### Fora de escopo

- Processamento assíncrono via consumidor SQS (coberto no `RFC-0006` — Fase 6).
- Publicação assíncrona da Outbox (coberta no `RFC-0007` — Fase 7).

## 3. Contratos HTTP detalhados

### 3.1 Carteiras (`WalletsController`)

1. `POST /wallets` → `201 Created` (ou `409 Conflict` se `(playerId, currency)` já existir):
   - Request (`OpenWalletRequestDto`): `{ playerId: UUID, initialBalance: { amount: string, currency: ISO-4217 } }`
   - Response (`OpenWalletResponseDto`): `{ id, playerId, balance: { amount, currency }, version, createdAt, updatedAt }`
2. `GET /wallets/:walletId` → `200 OK` (ou `404 Not Found`):
   - Response: `{ id, playerId, balance: { amount, currency }, version, createdAt, updatedAt }`
3. `GET /wallets/:walletId/ledger?cursor=...&limit=50` → `200 OK`:
   - Query (`ListWalletLedgerQueryDto`): `cursor` (string base64url opcional), `limit` (inteiro `1..200`, default `50`).
   - Response: `{ items: WalletLedgerEntryOutputDto[], nextCursor: string | null }`
4. `POST /wallets/:walletId/reconciliation` (e alias `POST /wallets/:walletId/reconcile`) → `200 OK`:
   - Response (`ReconcileWalletResponseDto`):
     ```json
     {
       "walletId": "0192f291-27dd-7d3f-8071-5f8685deef37",
       "storedBalance": { "amount": "975.00", "currency": "BRL" },
       "calculatedBalance": { "amount": "975.00", "currency": "BRL" },
       "difference": { "amount": "0.00", "currency": "BRL" },
       "consistent": true,
       "checkedEntries": 42,
       "walletBalance": { "amount": "975.00", "currency": "BRL" },
       "reconstructedBalance": { "amount": "975.00", "currency": "BRL" },
       "entryCount": 42,
       "lastVersion": 42
     }
     ```

### 3.2 Transações de Aposta (`WageringTransactionsController`)

1. `POST /wagering/transactions`:
   - Header obrigatório: `Idempotency-Key: <non-empty string>` (ausência ou vazio retorna `400 Bad Request`).
   - Request (`SubmitWagerTransactionRequestDto`):
     `{ providerId, externalTransactionId, playerId, walletId, roundId, gameId, kind, money: { amount, currency }, referenceExternalTransactionId? }`
   - Mapeamento declarativo de status HTTP (`WAGER_RESPONSE_STATUS_MAP`):
     - Replay idempotente (`idempotentReplay === true`): `200 OK`
     - `status === 'PROCESSED'` (`idempotentReplay === false`): `201 Created`
     - `status === 'PENDING_REFERENCE'` (`idempotentReplay === false`): `202 Accepted`
     - `status === 'REJECTED'` (`idempotentReplay === false`): `422 Unprocessable Entity`
   - Response (`SubmitWagerTransactionResponseDto`):
     ```json
     {
       "transactionId": "0192f298-345e-7e38-af88-e43f851a819d",
       "id": "0192f298-345e-7e38-af88-e43f851a819d",
       "status": "PROCESSED",
       "balance": { "amount": "975.00", "currency": "BRL" },
       "failureCode": null,
       "idempotentReplay": false,
       "transaction": { ... }
     }
     ```
2. `GET /wagering/transactions/:transactionId` → `200 OK` (ou `404 Not Found`).
3. `GET /providers/:providerId/wagering/transactions/:externalTransactionId` → `200 OK` (ou `404 Not Found`).

## 4. Tratamento declarativo de erros (`DomainExceptionFilter`)

O filtro global `DomainExceptionFilter` traduz `DomainError` e `ZodError` para respostas HTTP padronizadas utilizando a tabela `FAILURE_CODE_HTTP_STATUS` definida na [ADR-0013](../adr/0013-definir-taxonomia-de-failure-codes-e-mapeamento-http.md), sem cadeias `if / else / switch` por código de falha.

## 5. Plano de testes

- **Integração E2E HTTP (`test/integration/http/http-api.spec.ts`)**:
  - `POST /wallets` (`201`) e duplicata (`409 WALLET_ALREADY_EXISTS`).
  - `POST /wagering/transactions` sem `Idempotency-Key` (`400`), com `OPENING` (`400 OPENING_KIND_FORBIDDEN_EXTERNALLY`), `BET` válida (`201 PROCESSED`), replay idêntico (`200` com `idempotentReplay: true`), conflito de payload na mesma `Idempotency-Key` (`409 IDEMPOTENCY_PAYLOAD_CONFLICT`), saldo insuficiente (`422 INSUFFICIENT_FUNDS`), `REFUND` fora de ordem (`202 PENDING_REFERENCE`).
  - `GET /wallets/:walletId`, `GET /wallets/:walletId/ledger` paginado por cursor opaco, `GET /wagering/transactions/:transactionId`, `GET /providers/:providerId/wagering/transactions/:externalTransactionId`.
  - `POST /wallets/:walletId/reconciliation` retornando `consistent: true` e `difference: { amount: "0.00", currency: "BRL" }`.
  - Ao final de todos os testes: `assertAllWalletsMatchLedger`.
