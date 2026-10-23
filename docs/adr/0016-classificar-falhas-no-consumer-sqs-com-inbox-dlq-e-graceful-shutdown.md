# ADR-0016: Classificar falhas no consumer SQS com Inbox transacional, DLQ e graceful shutdown

- **Status**: Accepted
- **Data**: 2026-10-22
- **Fase do roadmap**: 6 — Consumer SQS + Inbox
- **RFC relacionada**: [RFC-0006](../rfc/RFC-0006-consumer-sqs-inbox-dlq-e-shutdown.md)

## Contexto e problema

Em uma fila SQS FIFO (`wager-transactions.fifo`), mensagens do mesmo `MessageGroupId` (`walletId`) são entregues em ordem. Se uma mensagem malformada (*poison pill*) ou com falha permanente for reentregue indefinidamente, ela bloqueia todas as mensagens subsequentes da mesma carteira. Ao mesmo tempo, falhas transitórias (como lock timeout sob contenção) devem sofrer retry com backoff até o limite `SQS_MAX_RECEIVE_COUNT`, e reentregas após commit não podem duplicar impactos financeiros.

## Opções consideradas

1. **Deduplicação via `inbox_messages` na mesma transação SQL + tabela declarativa de disposição (`ACK_TERMINAL`, `RETRY_TRANSIENT`, `PERMANENT_DLQ`) + encaminhamento explícito para `wager-transactions-dlq.fifo` quando permanente ou `receiveCount >= maxReceiveCount`**
2. **Depender apenas da Redrive Policy nativa do SQS para todo tipo de erro**
3. **Descartar silenciosamente mensagens com erro**

## Decisão

Adotar a **Opção 1**:

1. O registro em `inbox_messages (consumer_name, message_id)` ocorre dentro do mesmo `UnitOfWork` de `ProcessWagerTransactionUseCase`.
2. O `DeleteMessage` no SQS só é executado após o `COMMIT` da transação SQL.
3. Os erros capturados pelo consumer são classificados declarativamente por `FailureCode` em três disposições:
   - **`ACK_TERMINAL`**: rejeições de negócio já persistidas como `REJECTED` (com evento na Outbox) sofrem `DeleteMessage` normal.
   - **`RETRY_TRANSIENT`**: `WALLET_LOCK_TIMEOUT` e falhas de conexão ajustam `VisibilityTimeout` com backoff exponencial enquanto `receiveCount < SQS_MAX_RECEIVE_COUNT`; ao atingir `SQS_MAX_RECEIVE_COUNT`, a mensagem é publicada na `wager-transactions-dlq.fifo` e removida da fila principal.
   - **`PERMANENT_DLQ`**: payloads malformados ou violações permanentes de protocolo (`IDEMPOTENCY_PAYLOAD_CONFLICT`, `WALLET_NOT_FOUND`, `INVALID_MONEY_AMOUNT`, etc.) vão imediatamente para `wager-transactions-dlq.fifo` com atributos de diagnóstico e sofrem `DeleteMessage` na fila principal.
4. Em `SIGTERM` (`onApplicationShutdown`), o worker interrompe o loop, aguarda a mensagem em execução e devolve visibilidade (`VisibilityTimeout = 0`) de quaisquer mensagens ainda não iniciadas no lote.

## Consequências

### Positivas

- Nenhuma *poison pill* bloqueia um `MessageGroupId` por `maxReceiveCount` ciclos desnecessários.
- Compatibilidade idêntica entre AWS SQS real, MiniStack e LocalStack (mesmo que o emulador local tenha peculiaridades no redrive automático, o controle de `receiveCount >= maxReceiveCount` + Redrive Policy nativa garante determinismo).
- Zero perda e zero duplicação em caso de falha entre commit e ack.

### Negativas / trade-offs

- Requer gerenciamento explícito de `ChangeMessageVisibility` e `SendMessage` para a DLQ no adaptador do consumidor.

