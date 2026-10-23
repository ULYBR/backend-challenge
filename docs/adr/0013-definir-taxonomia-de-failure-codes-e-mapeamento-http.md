---
status: Accepted
date: 2026-10-22
deciders: [Ulysses Andrade Leal]
rfc: RFC-0004
---

# ADR-0013 — Definir a taxonomia de FailureCode e o mapeamento declarativo de status HTTP

## Contexto e problema

As seções 7.2 e 9 do desafio exigem que toda rejeição carregue um `failureCode` estável e legível por máquina e
que a API HTTP distinga com clareza — e de forma consistente — **payload inválido**, **conflito de idempotência**,
**rejeição por regra de negócio**, **aceite com processamento pendente** e **falha transitória de
infraestrutura**, sem colapsar essas situações em um mesmo status HTTP.

## Drivers da decisão

- Permitir que o provedor decida automaticamente se reenvia (`503`/`202`), corrige o contrato (`400`/`409`) ou
  trata como rejeição definitiva de negócio (`422`).
- Eliminar condicionais `if / else / switch` no mapeamento de erros por meio de tabelas declarativas (`Record`).

## Opções consideradas

1. **Mapeamento semântico distinto (`200`, `201`, `202`, `400`, `404`, `409`, `422`, `503`) governado por Lookup
   Tables declarativas**
2. **Retornar `200 OK` para todas as transações (inclusive `REJECTED`) ou `400 Bad Request` para tudo**

## Decisão

Escolhemos a **Opção 1**:

### 1. Mapeamento de Desfecho de `POST /wagering/transactions`

| Situação | Status HTTP | Corpo / Código | Ação do provedor |
|---|---|---|---|
| Transação `PROCESSED` (nova ou replay) | `200 OK` | `status: "PROCESSED"`, `idempotentReplay: boolean` | Concluído |
| Transação `PENDING_REFERENCE` (referência fora de ordem) | `202 Accepted` | `status: "PENDING_REFERENCE"`, `idempotentReplay: boolean` | Aguardar evento ou consultar depois |
| Transação `REJECTED` por regra de negócio (nova ou replay) | `422 Unprocessable Entity` | `status: "REJECTED"`, `failureCode`, `balance`, `idempotentReplay` | Não reenviar; rejeição definitiva de negócio |
| Conflito de idempotência (mesma key, payload diferente) ou wallet duplicada | `409 Conflict` | `failureCode: "IDEMPOTENCY_PAYLOAD_CONFLICT" \| "WALLET_ALREADY_EXISTS"` | Corrigir chave/payload; não reenviar |
| Recurso base inexistente (`walletId` ou transação consultada via GET) | `404 Not Found` | `failureCode: "WALLET_NOT_FOUND"` | Verificar identificador |
| Payload malformado, header `Idempotency-Key` ausente, `Money` inválido ou `OPENING` externo | `400 Bad Request` | `failureCode: "INVALID_MONEY_AMOUNT" \| "INVALID_CURRENCY_CODE" \| ...` | Corrigir payload |
| Falha transitória de infraestrutura (lock timeout, banco/fila indisponível) | `503 Service Unavailable` | `failureCode: "TRANSIENT_INFRASTRUCTURE_ERROR"` | Reenviar com a mesma `Idempotency-Key` |

### 2. Taxonomia de `FailureCode` em Rejeições de Negócio (`422`)

| `FailureCode` | Quando ocorre |
|---|---|
| `INSUFFICIENT_FUNDS` | `BET` com valor superior ao saldo disponível na wallet |
| `REVERSAL_WOULD_CAUSE_NEGATIVE_BALANCE` | `ROLLBACK` de `WIN` ou `REFUND` quando o jogador já consumiu o saldo (regra 7.9) |
| `CURRENCY_MISMATCH` | Moeda da transação difere da moeda da wallet |
| `WALLET_OWNERSHIP_MISMATCH` | `playerId` da transação difere do dono da wallet |
| `INVALID_REFERENCE_KIND` | `REFUND` referenciando não-`BET`, ou `ROLLBACK` referenciando `LOSS`/`ROLLBACK` |
| `REFERENCE_CONTEXT_MISMATCH` | Transação referenciada pertence a outro provider, wallet, player, moeda ou `roundId` |
| `REFERENCE_AMOUNT_MISMATCH` | Valor do `REFUND`/`ROLLBACK` difere do valor da transação referenciada |
| `REFERENCE_NOT_PROCESSED` | Transação referenciada existe mas está `REJECTED`/`FAILED`/`PENDING_REFERENCE` |
| `REFERENCE_ALREADY_REVERSED` | Transação referenciada já sofreu `REFUND` ou `ROLLBACK` efetivo |
| `REFERENCE_NOT_FOUND_TIMEOUT` | Esgotado o limite de tentativas do worker de `PENDING_REFERENCE` |

## Consequências

### Positivas

- Distinção inequívoca entre erro de contrato (`400`), conflito (`409`), rejeição financeira auditada (`422`),
  processamento pendente (`202`), sucesso (`200`) e falha transitória (`503`).
- Mesmo em `422` (`REJECTED`), a resposta inclui `transactionId`, `status: "REJECTED"`, `failureCode`, `balance`
  e `idempotentReplay`, permitindo replay idêntico.

### Negativas / trade-offs

- Clientes precisam tratar `200`, `202` e `422` como respostas que contêm estado de transação persistido.

### Como validar

- Testes de integração e e2e verificando o status HTTP e o `failureCode` para cada cenário.

## Referências

- [RFC-0004 — Pipeline de processamento de apostas, concorrência por wallet e idempotência persistente](../rfc/RFC-0004-pipeline-de-processamento-concorrencia-e-idempotencia.md)

