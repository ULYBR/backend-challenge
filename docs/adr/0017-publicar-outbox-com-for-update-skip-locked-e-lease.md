# ADR-0017: Publicar eventos da Transactional Outbox com `FOR UPDATE SKIP LOCKED` e lease temporal

- **Status**: Accepted
- **Data**: 2026-10-22
- **Fase do roadmap**: 7 — Transactional Outbox + eventos
- **RFC relacionada**: [RFC-0007](../rfc/RFC-0007-transactional-outbox-e-workers-assincronos.md)

## Contexto e problema

Em uma arquitetura escalável horizontalmente (`APP_ROLE=outbox` com múltiplas réplicas ECS Fargate), diversas instâncias do publisher consultam a tabela `outbox_messages` simultaneamente. É necessário:
1. Evitar que duas instâncias enviem o mesmo lote ao mesmo tempo sob operação normal.
2. Evitar que uma instância bloqueie outras enquanto aguarda a chamada de rede `SendMessage` para o SQS.
3. Garantir recuperação automática caso uma instância morra no meio da publicação após ter reservado um lote.

## Opções consideradas

1. **Claim atômico via `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING *` gravando lease temporal (`locked_by`, `locked_until`) fora da chamada de rede SQS**
2. **Manter transação SQL aberta com `SELECT ... FOR UPDATE SKIP LOCKED` durante a chamada HTTP para o SQS**
3. **Publisher singleton único com líder eleito**

## Decisão

Adotar a **Opção 1**:

1. O `claimDueBatch` executa um `UPDATE` atômico curto que seleciona até `OUTBOX_BATCH_SIZE` registros com `published_at IS NULL AND next_attempt_at <= now() AND (locked_until IS NULL OR locked_until <= now())` usando `FOR UPDATE SKIP LOCKED`, define `locked_by = workerId` e `locked_until = now() + OUTBOX_LEASE_MS` (default `15000ms`), e confirma imediatamente o lease.
2. Com a conexão SQL já liberada, o worker publica cada evento em `wallet-events.fifo` usando `MessageGroupId = aggregateId` e `MessageDeduplicationId = id`.
3. Para cada evento enviado com sucesso, grava `published_at = now()` e limpa `locked_by`/`locked_until`. Em caso de falha, incrementa `attempts`, calcula `next_attempt_at` com backoff exponencial e libera o lease.
4. Se o worker morrer durante o passo 2, o lease expira em `OUTBOX_LEASE_MS` e outra instância reprocessa a mensagem automaticamente.

## Consequências

### Positivas

- Conexões do pool PostgreSQL nunca ficam retidas durante I/O de rede externo (SQS).
- Escalabilidade horizontal linear com múltiplos publishers concorrentes sem contenção de locks.
- Recuperação automática de falhas de processo sem intervenção manual.

### Negativas / trade-offs

- Se uma instância sofrer pausa extrema maior que `OUTBOX_LEASE_MS`, outra instância pode republicar o evento (mitigado por `MessageDeduplicationId = eventId` no SQS FIFO e pela idempotência dos consumidores downstream).

