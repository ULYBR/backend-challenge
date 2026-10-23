---
name: db-migration
description: >-
  Use this skill when creating or changing the PostgreSQL schema of this project (tables, constraints,
  indexes, triggers, roles). Ensures migrations are versioned, reversible, written in explicit SQL and that
  every constraint is covered by an integration test.
---

# Criar uma migration

## Regras

- Migrations ficam em `src/infrastructure/persistence/migrations/` e são classes do MikroORM Migrator com
  **SQL escrito à mão** em `up()` e `down()`. Não use diff automático para constraints, triggers ou índices
  parciais.
- `down()` desfaz exatamente o `up()`, na ordem inversa.
- Nomeie constraints explicitamente; o código mapeia erros pelo nome:
  - `pk_<tabela>`, `uq_<tabela>__<colunas>`, `fk_<tabela>__<ref>`, `ck_<tabela>__<regra>`,
    `ix_<tabela>__<colunas>`, `trg_<tabela>__<regra>`.
- Dinheiro: `NUMERIC(19,2)`; moeda: `CHAR(3)` com `CHECK (currency ~ '^[A-Z]{3}$')`.
- Enums: `TEXT` + `CHECK (col IN (...))` (ver ADR de enums).
- Timestamps: `TIMESTAMPTZ NOT NULL DEFAULT now()`.
- Nunca altere uma migration já aplicada/commitada; crie uma nova.

## Passos

1. Crie a migration: `bun run db:migration:create --name <descricao>`.
2. Escreva `up()` e `down()` seguindo as regras acima.
3. Rode o ciclo completo e confirme que não há erro:
   `bun run db:migrate:up && bun run db:migrate:down && bun run db:migrate:up`.
4. Para **cada** constraint/trigger novo, adicione um teste em `test/integration/schema/` que tenta violar a
   regra com SQL direto e verifica o erro pelo **nome** da constraint (ou a mensagem do trigger).
5. Atualize o diagrama ER em `docs/diagrams/` e a tabela "invariante → garantia" do RFC de modelagem.

## Validação

- `bun test test/integration/schema` verde.
- Ciclo `up → down → up` sem erro.

