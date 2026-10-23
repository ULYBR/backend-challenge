---
rfc: RFC-0007
title: Transactional Outbox Publisher concorrente com lease e resolução assíncrona de referências pendentes
status: Implemented
author: Ulysses Andrade Leal
created: 2026-10-22
updated: 2026-10-22
phase: 7
adrs: [ADR-0017, ADR-0018]
---

# RFC-0007 — Transactional Outbox Publisher concorrente com lease e resolução assíncrona de referências pendentes

## 1. Resumo

Especifica os dois workers de background do sistema:
1. **`OutboxPublisherWorker` (`APP_ROLE=outbox`)**: consome lotes de `outbox_messages` pendentes usando `FOR UPDATE SKIP LOCKED` com *lease* temporal (`locked_by`, `locked_until`), publica os eventos de integração na fila SQS FIFO `wallet-events.fifo` (particionados por `aggregateId` como `MessageGroupId` e deduplicados por `eventId` como `MessageDeduplicationId`), marca `published_at` após confirmação do SQS e aplica backoff exponencial em caso de falha.
2. **`PendingReferenceWorker` (`APP_ROLE=scheduler`)**: varre periodicamente transações em estado `PENDING_REFERENCE` vencidas (`next_reference_attempt_at <= now()`) com `FOR UPDATE SKIP LOCKED`, tenta reconciliá-las contra a transação referenciada sob o lock pessimista da carteira, aplicando a mutação financeira quando a referência já estiver `PROCESSED` ou rejeitando com `REFERENCE_NOT_FOUND_TIMEOUT` ao atingir `PENDING_REF_MAX_ATTEMPTS`.

## 2. Motivação e escopo

Na Seção 11 do desafio, a persistência de transação, saldo, ledger, inbox e outbox é atômica no PostgreSQL, mas a entrega do evento ao broker externo (SQS) ocorre fora da transação SQL. Se o processo morrer imediatamente após o `COMMIT` e antes do envio ao SQS, outra instância precisa assumir o evento e publicá-lo sem perda e sem bloqueio entre múltiplos publishers concorrentes.

Analogamente, na Seção 7.5 do desafio, um `REFUND` ou `ROLLBACK` pode chegar antes da `BET` ou `WIN` referenciada. O `PendingReferenceWorker` garante que essas transações sejam resolvidas assincronamente assim que a transação original for confirmada, ou rejeitadas deterministicamente após o número máximo de tentativas.

## 3. Desenho detalhado

### 3.1 `OutboxPublisherWorker`

1. **Claim atômico com lease (`MikroOrmOutboxRepository.claimDueBatch`)**:
   ```sql
   UPDATE outbox_messages
      SET locked_by = $1,
          locked_until = $2
    WHERE id IN (
      SELECT id
        FROM outbox_messages
       WHERE published_at IS NULL
         AND next_attempt_at <= $3
         AND (locked_until IS NULL OR locked_until <= $3)
       ORDER BY next_attempt_at ASC, occurred_at ASC
       LIMIT $4
         FOR UPDATE SKIP LOCKED
    )
   RETURNING *;
   ```
2. **Publicação no SQS (`wallet-events.fifo`)**:
   - `MessageBody`: `JSON.stringify(message.payload)`
   - `MessageGroupId`: `message.aggregateId` (preserva ordem por carteira/transação)
   - `MessageDeduplicationId`: `message.id` (`eventId` único)
3. **Confirmação ou Retry**:
   - Sucesso no SQS → `message.markPublished(now)` e `outboxRepository.update(message)`.
   - Erro no SQS → `message.scheduleRetry(now, errorMessage)` (incrementa `attempts`, calcula `next_attempt_at` com backoff exponencial `min(60s, 1s * 2^(attempts-1))`, limpa `locked_until`/`locked_by` e grava `last_error`) e `outboxRepository.update(message)`.
4. **Recuperação de crash (cenário obrigatório da Seção 11)**:
   - Se o worker A reservar um lote (`locked_until = now + 15s`) e morrer antes de publicar, assim que `locked_until` expirar (ou imediatamente se o crash ocorreu logo após o commit da transação de negócio antes do claim), o worker B captura a mensagem via `claimDueBatch` e publica normalmente.

### 3.2 `PendingReferenceWorker`

1. Invoca `ProcessWagerTransactionUseCase.resolvePendingReferenceBatch(batchSize, env.PENDING_REF_MAX_ATTEMPTS)`.
2. Para cada transação `PENDING_REFERENCE` com `next_reference_attempt_at <= now()`:
   - Adquire lock pessimista `SELECT ... FOR UPDATE` na carteira (`walletId`).
   - Recarrega a transação `PENDING_REFERENCE` sob o lock.
   - Se a transação referenciada (`reference_external_transaction_id`) já existir:
     - Valida contexto, status `PROCESSED`, `kind` permitido, valor exato e unicidade de reversão.
     - Se válida: debita/credita a carteira, grava `WalletLedgerEntry`, transiciona para `PROCESSED` e enfileira `WalletBalanceChanged` + `WagerTransactionProcessed` na Outbox.
     - Se inválida: transiciona para `REJECTED` com o `FailureCode` correspondente e enfileira `WagerTransactionRejected` na Outbox.
   - Se a transação referenciada ainda não existir:
     - Se `referenceAttempts >= PENDING_REF_MAX_ATTEMPTS`: transiciona para `REJECTED` (`REFERENCE_NOT_FOUND_TIMEOUT`) e enfileira `WagerTransactionRejected`.
     - Caso contrário: incrementa `referenceAttempts`, agenda próximo `nextReferenceAttemptAt` com backoff exponencial (`250ms * 2^attempts`) e enfileira `WagerTransactionPendingReference`.

## 4. Plano de testes

- **Integração Outbox (`test/integration/messaging/outbox-publisher.spec.ts`)**:
  - Publicação de `WalletBalanceChanged`, `WagerTransactionProcessed`, `WagerTransactionRejected` e `WagerTransactionPendingReference` em `wallet-events.fifo`.
  - Cenário de crash após commit: transação confirmada no banco sem publicação imediata; instância secundária do `OutboxPublisherWorker` assume o lote (inclusive após expiração de `locked_until`) e entrega no SQS sem perda.
  - Concorrência entre 3 instâncias simultâneas do `OutboxPublisherWorker` disputando 30 mensagens da Outbox: `FOR UPDATE SKIP LOCKED` garante partição disjunta sem perda.
- **Integração Pending Reference (`test/integration/messaging/pending-reference-worker.spec.ts`)**:
  - `ROLLBACK` / `REFUND` chega antes da `BET` → fica em `PENDING_REFERENCE` → `BET` chega → `PendingReferenceWorker.runOnce()` processa a reversão e atualiza saldo/ledger/outbox.
  - `ROLLBACK` órfão expira após `PENDING_REF_MAX_ATTEMPTS` → `REJECTED (REFERENCE_NOT_FOUND_TIMEOUT)` + `WagerTransactionRejected` na Outbox.
