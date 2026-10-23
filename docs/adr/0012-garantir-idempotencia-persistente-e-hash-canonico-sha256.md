---
status: Accepted
date: 2026-10-22
deciders: [Ulysses Andrade Leal]
rfc: RFC-0004
---

# ADR-0012 — Garantir idempotência persistente no PostgreSQL com payloadHash SHA-256 de JSON canônico

## Contexto e problema

As seções 5, 7 e 9 do desafio proíbem idempotência baseada apenas em memória e determinam que:
- O header `Idempotency-Key` é obrigatório na entrada HTTP (e enviado no payload da fila SQS);
- `payloadHash` deve ser o hash de um **JSON canônico** (chaves ordenadas) do subconjunto de campos de negócio;
- Requisição repetida com o mesmo payload retorna o resultado original (incluindo o saldo observado no momento do
  processamento) com `idempotentReplay: true`;
- Mesma `Idempotency-Key` com payload diferente é **conflito** (`409 Conflict`), e não replay.

## Drivers da decisão

- Determinismo independentemente da ordem das chaves no JSON enviado pelo cliente ou da formatação de `amount`
  (`"25"` vs `"25.00"`).
- Garantia final no PostgreSQL (`uq_wager_transactions__provider_idempotency_key`), segura sob múltiplas
  instâncias.
- Fidelidade do replay: devolver exatamente o saldo observado na execução original (`recorded_balance`), mesmo que
  a carteira tenha sofrido novas movimentações depois.

## Opções consideradas

1. **SHA-256 sobre JSON canônico com chaves ordenadas recursivamente e `Money.amount` normalizado (2 casas) +
   coluna `recorded_balance` + unique constraint no PostgreSQL**
2. **SHA-256 sobre o body bruto (`rawBody`) da requisição HTTP**
3. **Cache Redis/memória com TTL**

## Decisão

Escolhemos a **Opção 1**:

- `CanonicalPayloadHasher` constrói um objeto contendo exclusivamente os campos de negócio
  (`providerId`, `externalTransactionId`, `playerId`, `walletId`, `roundId`, `gameId`, `kind`,
  `money: { amount, currency }` com `amount` já normalizado em 2 casas decimais, e
  `referenceExternalTransactionId: string | null`), ordena todas as chaves lexicograficamente de forma recursiva,
  serializa em JSON compacto e calcula `SHA-256` hex (64 chars).
- Na primeira execução de uma transação terminal (`PROCESSED` ou `REJECTED`), gravamos `recorded_balance` na
  linha de `wager_transactions`.
- Em qualquer repetição (seja detectada na leitura após o `SELECT ... FOR UPDATE` da wallet, seja na captura de
  violação `23505` de `uq_wager_transactions__provider_idempotency_key`), comparamos `existing.matchesPayload(payloadHash)`:
  - Se igual → retornamos o estado original e `recorded_balance` com `idempotentReplay: true`;
  - Se diferente → lançamos `IdempotencyConflictError` (`IDEMPOTENCY_PAYLOAD_CONFLICT`).

## Consequências

### Positivas

- Reenviar `{ "amount": "25", "currency": "BRL" }` ou `{ "currency": "BRL", "amount": "25.00" }` produz o mesmo
  `payloadHash`, evitando falsos conflitos de formatação.
- O replay retorna o saldo histórico exato observado pela transação original, cumprindo a regra 7.7 mesmo após
  apostas subsequentes.

### Negativas / trade-offs

- Se uma transação ainda estiver em `PENDING_REFERENCE` no momento do replay, `recorded_balance` ainda não existe
  e o replay retorna o saldo atual da carteira junto ao status `PENDING_REFERENCE`.

### Como validar

- Testes unitários em `canonical-payload-hasher.spec.ts` e testes de integração/concorrência (`50×` paralelo e
  payload divergente).

## Referências

- [RFC-0004 — Pipeline de processamento de apostas, concorrência por wallet e idempotência persistente](../rfc/RFC-0004-pipeline-de-processamento-concorrencia-e-idempotencia.md)

