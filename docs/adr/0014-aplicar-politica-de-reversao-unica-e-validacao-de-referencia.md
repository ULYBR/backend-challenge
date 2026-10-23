---
status: Accepted
date: 2026-10-22
deciders: [Ulysses Andrade Leal]
rfc: RFC-0004
---

# ADR-0014 — Aplicar política de reversão única por transação referenciada e código distinto para saldo negativo em reversão

## Contexto e problema

A seção 7 do desafio define duas regras críticas para reversões (`REFUND` e `ROLLBACK`):
- Regra 7.4: *"Uma referência não pode ser revertida duas vezes pelo mesmo tipo de operação."*
- Regra 7.9: *"Reversão que produziria saldo negativo é **rejeitada explicitamente**, com um `failureCode`
  distinto do de uma aposta sem saldo — são situações operacionalmente diferentes — e permanece auditável."*

Se permitíssemos que uma mesma `BET` recebesse tanto um `REFUND` quanto um `ROLLBACK`, o jogador receberia
**dois créditos** para um único débito, violando a invariante global da seção 3 (*"o sistema não pode duplicar
créditos"*).

## Drivers da decisão

- Impedir duplicação de crédito sob qualquer combinação de `REFUND` e `ROLLBACK`.
- Distinguir operacionalmente falta de saldo em aposta (`INSUFFICIENT_FUNDS`) de falta de saldo ao reverter um
  crédito anterior (`REVERSAL_WOULD_CAUSE_NEGATIVE_BALANCE`).

## Opções consideradas

1. **Política estrita: no máximo uma reversão efetiva (`PROCESSED`) — seja `REFUND` ou `ROLLBACK` — por transação
   referenciada, garantida no caso de uso e no partial unique index `uq_wager_transactions__single_reversal`**
2. **Permitir um `REFUND` e um `ROLLBACK` sobre a mesma `BET`**

## Decisão

Escolhemos a **Opção 1** (conforme decisão D2 do [ROADMAP](../ROADMAP.md)):

- Uma transação referenciada (`BET`, `WIN` ou `REFUND`) pode ser revertida com sucesso (`PROCESSED`) **no máximo
  uma única vez**, independentemente de a segunda tentativa ser `REFUND` ou `ROLLBACK`.
- Tentativas subsequentes de reverter a mesma transação são persistidas como `REJECTED` com
  `failureCode = FailureCode.ReferenceAlreadyReversed` (`REFERENCE_ALREADY_REVERSED`).
- Quando um `ROLLBACK` de `WIN` ou de `REFUND` resulta em débito superior ao saldo atual da carteira, a transação
  é persistida como `REJECTED` com `failureCode = FailureCode.ReversalWouldCauseNegativeBalance`
  (`REVERSAL_WOULD_CAUSE_NEGATIVE_BALANCE`).

## Consequências

### Positivas

- Elimina completamente a brecha de crédito duplo (`REFUND` + `ROLLBACK` na mesma `BET`).
- Fornece visibilidade operacional imediata quando um provedor tenta estornar um ganho que o jogador já apostou
  ou sacou (`REVERSAL_WOULD_CAUSE_NEGATIVE_BALANCE`).

### Negativas / trade-offs

- Mais restritivo que a leitura literal de "pelo mesmo tipo", documentado explicitamente na seção 10 do
  `ARCHITECTURE.md` como interpretação de segurança financeira.

### Como validar

- Testes em `process-wager-transaction.spec.ts` verificando `REFUND` seguido de `ROLLBACK` na mesma `BET`
  (`REFERENCE_ALREADY_REVERSED`) e `ROLLBACK` de `WIN` após consumo do saldo
  (`REVERSAL_WOULD_CAUSE_NEGATIVE_BALANCE`).

## Referências

- [RFC-0004 — Pipeline de processamento de apostas, concorrência por wallet e idempotência persistente](../rfc/RFC-0004-pipeline-de-processamento-concorrencia-e-idempotencia.md)

