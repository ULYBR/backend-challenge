---
status: Accepted
date: 2026-10-22
deciders: [Ulysses Andrade Leal]
rfc: RFC-0002
---

# ADR-0008 — Modelar enums no PostgreSQL com colunas TEXT e CHECK constraints

## Contexto e problema

O domínio possui três conjuntos fechados de valores:
- `WagerTransactionKind`: `OPENING`, `BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`;
- `WagerTransactionStatus`: `PENDING`, `PENDING_REFERENCE`, `PROCESSED`, `REJECTED`, `FAILED`;
- `LedgerDirection`: `DEBIT`, `CREDIT`.

Precisamos decidir se no PostgreSQL essas colunas serão representadas como tipos `CREATE TYPE ... AS ENUM` ou
como `TEXT` com `CHECK (col IN (...))`.

## Drivers da decisão

- Migrations reversíveis (`up` e `down`) simples e livres de estado órfão no catálogo `pg_type`.
- Evolução de valores permitidos sem restrições transacionais de `ALTER TYPE ... REMOVE VALUE` (que o PostgreSQL
  não suporta diretamente).
- Mensagens de erro previsíveis pelo nome explícito da constraint (`ck_wager_transactions__kind_enum`,
  `ck_wager_transactions__status_enum`, `ck_wallet_ledger_entries__direction_enum`).

## Opções consideradas

1. **Colunas `TEXT NOT NULL` com `CHECK (col IN (...))` nomeadas**
2. **Tipos `CREATE TYPE ... AS ENUM` nativos do PostgreSQL**

## Decisão

Escolhemos a **Opção 1**: todas as colunas de enumeração usam `TEXT NOT NULL` acompanhadas de `CHECK` constraint
explicitamente nomeada.

## Consequências

### Positivas

- `up` e `down` das migrations não precisam gerenciar ciclo de vida de tipos globais do schema.
- Adicionar ou remover um valor em uma migration futura é apenas um `DROP CONSTRAINT` + `ADD CONSTRAINT`.
- Integração direta com strings em queries parametrizadas do MikroORM e `pg`, sem necessidade de cast `::enum_type`.

### Negativas / trade-offs

- Ocupa alguns bytes a mais por linha do que os 4 bytes de um `ENUM` nativo (irrelevante diante das demais
  colunas da linha e compensado por compressão/alinhamento).

### Como validar

- Testes de integração em `test/integration/schema/schema-constraints.spec.ts` inserem valores fora do domínio em
  `kind`, `status` e `direction` e verificam a rejeição pelas constraints `ck_*__*_enum`.

## Referências

- [RFC-0002 — Modelagem de dados, design de relacionamentos e invariantes no schema PostgreSQL](../rfc/RFC-0002-modelagem-de-dados-e-relacionamentos.md)

