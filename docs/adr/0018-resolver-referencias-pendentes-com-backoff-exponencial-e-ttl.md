# ADR-0018: Resolver referências pendentes (`PENDING_REFERENCE`) com backoff exponencial e limite determinístico de tentativas

- **Status**: Accepted
- **Data**: 2026-10-22
- **Fase do roadmap**: 8 — Referências fora de ordem
- **RFC relacionada**: [RFC-0004](../rfc/RFC-0004-pipeline-de-processamento-concorrencia-e-idempotencia.md) · [RFC-0007](../rfc/RFC-0007-transactional-outbox-e-workers-assincronos.md)

## Contexto e problema

Em provedores de jogos distribuídos, mensagens de `REFUND` ou `ROLLBACK` podem chegar antes da `BET` ou `WIN` correspondente devido a retries em rotas distintas ou paralelismo na origem. Rejeitar imediatamente uma reversão cuja referência ainda está em trânsito degrada a consistência operacional; por outro lado, manter uma transação em `PENDING_REFERENCE` eternamente quando a referência jamais existiu impede o fechamento contábil.

## Opções consideradas

1. **Estado intermediário `PENDING_REFERENCE` com agendamento exponencial (`next_reference_attempt_at`), varredura concorrente via `FOR UPDATE SKIP LOCKED` e rejeição automática (`REFERENCE_NOT_FOUND_TIMEOUT`) após `PENDING_REF_MAX_ATTEMPTS`**
2. **Rejeitar imediatamente qualquer `REFUND`/`ROLLBACK` sem referência localizada**
3. **Bloquear a thread HTTP/SQS com `sleep` aguardando a chegada da referência**

## Decisão

Adotar a **Opção 1**:

1. Quando `REFUND` ou `ROLLBACK` não localiza `referenceExternalTransactionId` na primeira tentativa, a transação é persistida com `status = 'PENDING_REFERENCE'`, `reference_attempts = 1` e `next_reference_attempt_at = now() + 250ms`, emitindo `WagerTransactionPendingReference` na Outbox.
2. O `PendingReferenceWorker` (`APP_ROLE=scheduler`) consulta periodicamente o índice parcial `ix_wager_transactions__pending_reference_due` com `FOR UPDATE SKIP LOCKED`.
3. A cada tentativa em que a referência ainda não chegou, `reference_attempts` é incrementado e `next_reference_attempt_at` avança segundo `min(10000ms, 250ms * 2^reference_attempts)`.
4. Assim que a transação referenciada é localizada, o worker adquire o lock pessimista da carteira (`SELECT ... FOR UPDATE`) e aplica a mesma validação e mutação financeira do fluxo principal.
5. Ao atingir `PENDING_REF_MAX_ATTEMPTS` (default `8`) sem localizar a referência, a transação transiciona para o estado terminal `REJECTED` com `failureCode = 'REFERENCE_NOT_FOUND_TIMEOUT'`, emitindo `WagerTransactionRejected` na Outbox.

## Consequências

### Positivas

- Absorve reordenações de rede sem bloquear conexões HTTP ou workers SQS.
- Garante convergência determinística para um estado terminal (`PROCESSED` ou `REJECTED`) em tempo limitado.
- Todas as transições são auditáveis via eventos de integração na Outbox.

### Negativas / trade-offs

- Introduz latência adicional de reconciliação (centenas de milissegundos) apenas para transações entregues fora de ordem.

