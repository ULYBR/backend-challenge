---
rfc: RFC-0006
title: Consumidor SQS FIFO com Inbox persistente, classificação declarativa de falhas, DLQ e graceful shutdown
status: Implemented
author: Ulysses Andrade Leal
created: 2026-10-22
updated: 2026-10-22
phase: 6
adrs: [ADR-0016]
---

# RFC-0006 — Consumidor SQS FIFO com Inbox persistente, classificação declarativa de falhas, DLQ e graceful shutdown

## 1. Resumo

Especifica o consumidor assíncrono da fila `wager-transactions.fifo` (`WagerTransactionsSqsConsumer`), responsável por receber eventos `WagerTransactionRequested`, deduplicar entregas via tabela `inbox_messages` na **mesma transação SQL** da mutação financeira (`ProcessWagerTransactionUseCase`), confirmar (`DeleteMessage`) **somente após o commit**, rotear falhas permanentes ou que excedam `SQS_MAX_RECEIVE_COUNT` para `wager-transactions-dlq.fifo` e encerrar com *graceful shutdown* em `SIGTERM`.

## 2. Motivação e escopo

Sistemas distribuídos de mensageria operam sob semântica *at-least-once*: uma mensagem pode ser reentregue se o worker sofrer crash entre o commit no PostgreSQL e o `DeleteMessage` no SQS, ou após expiração do *visibility timeout*. Além disso, falhas precisam ser tratadas de acordo com sua natureza sem bloquear a fila FIFO indefinidamente.

## 3. Desenho detalhado

### 3.1 Contrato de Mensagem (`WagerTransactionRequestedDto`)

```json
{
  "messageId": "msg-123",
  "type": "WagerTransactionRequested",
  "correlationId": "optional-uuid",
  "occurredAt": "2026-07-29T15:00:00.000Z",
  "data": {
    "providerId": "provider-a",
    "externalTransactionId": "transaction-123",
    "idempotencyKey": "provider-a:transaction-123",
    "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
    "walletId": "0192f28f-5dc0-7d3f-8071-5f8685deef37",
    "roundId": "round-987",
    "gameId": "fortune-chimp",
    "kind": "BET",
    "money": { "amount": "25.00", "currency": "BRL" },
    "referenceExternalTransactionId": "optional-ref"
  }
}
```

### 3.2 Fluxo de Processamento e Transação Única com Inbox

1. O consumidor recebe a mensagem SQS (`MessageId`, `ReceiptHandle`, `Body`, `Attributes.ApproximateReceiveCount`).
2. Calcula `rawPayloadHash = CanonicalPayloadHasher.computeRaw(rawBody)`.
3. Valida o envelope JSON com Zod (`wagerTransactionRequestedMessageSchema`).
   - Se o JSON for malformado ou violar o contrato de schema → classifica como `PERMANENT_DLQ`: publica a mensagem original enriquecida com metadados de falha em `wager-transactions-dlq.fifo` e executa `DeleteMessage` na fila principal.
4. Invoca `ProcessWagerTransactionUseCase.execute({ ...data, inboxRegistration: { consumerName, messageId, payloadHash: rawPayloadHash } })`.
   - Dentro do `UnitOfWork`:
     - Verifica `(consumer_name, message_id)` em `inbox_messages`.
     - Se já existir e estiver processada com o mesmo `payloadHash`, retorna replay idempotente sem reexecutar débito/crédito.
     - Se for inédita, insere em `inbox_messages`, processa a transação (ou persiste `REJECTED` / `PENDING_REFERENCE`), grava `outbox_messages` e marca `inbox_messages.processed_at = now()` antes do `COMMIT`.
5. Somente após o retorno do `COMMIT`, o consumidor chama `DeleteMessageCommand` na fila principal.

### 3.3 Classificação Declarativa de Erros (`CONSUMER_ERROR_DISPOSITION_MAP`)

| Categoria | Causas | Ação do Consumidor |
|---|---|---|
| `ACK_TERMINAL` | Transação `PROCESSED`, `REJECTED` por regra de negócio (`INSUFFICIENT_FUNDS`, `CURRENCY_MISMATCH`, etc.) ou `PENDING_REFERENCE` | Commit já realizado → `DeleteMessage` |
| `RETRY_TRANSIENT` | `WalletLockTimeoutError` (`WALLET_LOCK_TIMEOUT`) ou erro transitório de conexão com banco | Se `receiveCount >= maxReceiveCount` → move para DLQ + `DeleteMessage`; caso contrário aplica `ChangeMessageVisibility` com backoff exponencial |
| `PERMANENT_DLQ` | JSON inválido, schema inválido, `OPENING_KIND_FORBIDDEN_EXTERNALLY`, `IDEMPOTENCY_PAYLOAD_CONFLICT`, `WALLET_NOT_FOUND` | Publica em `wager-transactions-dlq.fifo` + `DeleteMessage` na fila principal |

### 3.4 Graceful Shutdown (`SIGTERM` / `OnApplicationShutdown`)

- `stopPolling()` sinaliza `isShuttingDown = true`, interrompendo novos ciclos de polling.
- Aguarda a conclusão da mensagem/lote em andamento (`inFlightPromise`); para mensagens recebidas no lote mas ainda não iniciadas, executa `ChangeMessageVisibilityCommand(VisibilityTimeout: 0)` devolvendo-as imediatamente para outra instância.

## 4. Plano de testes

- **Integração (`test/integration/messaging/sqs-consumer.spec.ts`)**:
  - Processamento end-to-end de `WagerTransactionRequested` na fila `wager-transactions.fifo`: saldo atualizado, `inbox_messages` gravado com `processed_at`, `outbox_messages` enfileirado e mensagem removida da fila.
  - Redelivery da mesma `messageId` (simulando crash após commit e antes do ack): segundo consumo detecta `inbox_messages` / idempotência, não altera saldo e faz ack da mensagem.
  - Mensagem inválida ou conflito permanente: enviada para `wager-transactions-dlq.fifo` e removida da fila principal.
  - Falha transitória excedendo `maxReceiveCount`: movida para `wager-transactions-dlq.fifo` após N tentativas.
  - Verificação final `assertAllWalletsMatchLedger`.
