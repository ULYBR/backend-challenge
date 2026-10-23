---
status: Accepted
date: 2026-10-22
deciders: [Ulysses Andrade Leal]
rfc: RFC-0003
---

# ADR-0010 — Expressar a máquina de estados e as regras por tipo de transação com mapas declarativos em vez de condicionais

## Contexto e problema

As entidades `WagerTransaction`, `WalletLedgerEntry` e `Wallet` possuem regras que variam conforme o tipo de
operação (`OPENING`, `BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`), o estado atual (`PENDING`,
`PENDING_REFERENCE`, `PROCESSED`, `REJECTED`, `FAILED`) e a direção contábil (`DEBIT`, `CREDIT`). Implementar
essas variações com cadeias de `if / else if / switch` espalha a lógica de negócio por vários métodos e dificulta
a verificação exaustiva em tempo de compilação.

## Drivers da decisão

- Eliminar ramificações `if / else / switch` desnecessárias no domínio (regra explícita em `AGENTS.md`).
- Garantir exaustividade em tempo de compilação usando `Record<EnumType, Policy>` do TypeScript.
- Concentrar as transições válidas e políticas de cada operação em estruturas de dados imutáveis e auditáveis.

## Opções consideradas

1. **Lookup Tables / Strategy Maps tipados com `Record<Enum, Policy>` + guard clauses `assert*` encapsuladas**
2. **Subclasses polimórficas para cada `WagerTransactionKind` e State Pattern clássico com 5 classes de estado**
3. **Condicionais `if / else` e `switch` dentro dos métodos da entidade**

## Decisão

Escolhemos a **Opção 1**:

- Definimos `KIND_POLICIES: Readonly<Record<WagerTransactionKind, KindPolicy>>` contendo `isExternalSubmissible`,
  `affectsBalance`, `requiresReference`, `allowedReferenceKinds` e a função `resolveDirection(reference?)`.
- Definimos `ALLOWED_STATUS_TRANSITIONS: Readonly<Record<WagerTransactionStatus, ReadonlySet<WagerTransactionStatus>>>`
  para governar a máquina de estados de `WagerTransaction`.
- Definimos `DIRECTION_ARITHMETIC: Readonly<Record<LedgerDirection, (before: Money, amount: Money) => Money>>`
  para calcular e validar o saldo resultante em `WalletLedgerEntry` e `Wallet`.
- Usamos `if` exclusivamente como *guard clause* de falha rápida dentro de métodos privados `assert*`
  (`assertSameCurrency`, `assertCanTransitionTo`, `assertBalanced`).

## Consequências

### Positivas

- Adicionar um novo `WagerTransactionKind` ou `WagerTransactionStatus` força erro de compilação imediato em
  `Record<...>` até que sua política seja declarada.
- Os métodos de `WagerTransaction` (`affectsBalance()`, `requiresReference()`, `ledgerDirectionFor()`) tornam-se
  delegações de uma única linha (`return KIND_POLICIES[this.kind].affectsBalance`).

### Negativas / trade-offs

- Requer definição cuidadosa das interfaces de política no mesmo módulo da entidade.

### Como validar

- Suíte `test/unit/domain/*.spec.ts` cobrindo todas as entradas das tabelas de políticas e transições inválidas.

## Referências

- [RFC-0003 — Modelo de domínio puro, políticas declarativas e máquina de estados](../rfc/RFC-0003-modelo-de-dominio-e-maquina-de-estados.md)

