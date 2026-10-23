---
status: Accepted
date: 2026-10-22
deciders: [Ulysses Andrade Leal]
rfc: RFC-0001
---

# ADR-0003 — Usar MikroORM v6 com EntitySchema e mappers explícitos sem decorators no domínio

## Contexto e problema

A seção 4 do desafio indica **MikroORM** como ORM preferencial (ou TypeORM como alternativa aceita) e pede que a
escolha, o mapeamento de `Money` e a estratégia transacional sejam justificados em `ARCHITECTURE.md`. Ao mesmo
tempo, a seção 6 exige que as classes de domínio (`Wallet`, `WagerTransaction`, `WalletLedgerEntry`,
`InboxMessage`, `OutboxMessage`) tenham construtores `private`/`protected`, factories estáticas (`create`,
`open`, `rehydrate`) e **zero dependência de decorators do ORM ou do NestJS**.

## Drivers da decisão

- Preservar o domínio 100% puro (sem `@Entity()`, `@Property()` nem construtores públicos vazios).
- Garantir que a reconstrução do banco passe sempre por `rehydrate()`, sem disparar regras de transição.
- Ter controle explícito da transação SQL (`em.transactional()`) e de locks pessimistas
  (`LockMode.PESSIMISTIC_WRITE` / `FOR UPDATE`).

## Opções consideradas

1. **MikroORM v6 com `EntitySchema` aplicado a classes/records de persistência + Data Mappers explícitos (`toPersistence` / `toDomain` via `rehydrate`)**
2. **MikroORM v6 mapeando diretamente as classes de domínio via `EntitySchema`**
3. **TypeORM com `EntitySchema` e QueryRunner manual**

## Decisão

Escolhemos a **Opção 1**:

- Usamos **MikroORM v6** (`@mikro-orm/postgresql` e `@mikro-orm/migrations`).
- Na camada `src/infrastructure/persistence/schemas/`, definimos records de persistência (`WalletRecord`,
  `WagerTransactionRecord`, `WalletLedgerEntryRecord`, `InboxMessageRecord`, `OutboxMessageRecord`) mapeados com
  `EntitySchema`.
- Na camada `src/infrastructure/persistence/mappers/`, mappers puros convertem `Record -> Domain` chamando
  `Entity.rehydrate(...)` (reconstruindo `Money` a partir de `amount: string` + `currency: string`) e
  `Domain -> Record`.
- A unidade de trabalho (`UnitOfWork`) encapsula `EntityManager.transactional()`, garantindo que inbox,
  transação, saldo, ledger e outbox compartilhem a mesma transação SQL no PostgreSQL.

## Consequências

### Positivas

- As entidades de domínio permanecem idênticas ao modelo da seção 6: campos privados (`_balance`, `_status`),
  construtores privados e `Money` como Value Object rico, mesmo quando o banco armazena `amount` e `currency` em
  colunas separadas.
- Nenhum risco do ORM mutar campos privados por reflexão ou ignorar invariantes.
- Controle direto de `LockMode.PESSIMISTIC_WRITE` e SQL parametrizado dentro da mesma transação.

### Negativas / trade-offs

- Código adicional para os `Record`s e `Mapper`s (cerca de 30–50 linhas por entidade). Em um sistema com apenas
  5 tabelas, o custo é baixo e o ganho em clareza arquitetural é alto.

### Como validar

- Teste de arquitetura verifica que nenhum arquivo em `src/domain/**` importa `@mikro-orm/*`.
- Testes de integração provam round-trip (`save` → `findById` → `rehydrate`) preservando `Money` com precisão
  exata.

## Prós e contras das opções

### Opção 1 — MikroORM + Persistence Records + Mappers (`rehydrate`)

- Bom, porque respeita integralmente a regra 6.0 (`rehydrate` explícito + construtor privado) e separa colunas
  (`amount`, `currency`) do Value Object `Money`.
- Ruim, porque requer mappers explícitos.

### Opção 2 — MikroORM mapeando classes de domínio diretamente

- Bom, porque elimina a classe de `Record`.
- Ruim, porque o MikroORM instancia objetos via `Object.create` e popula propriedades privadas diretamente,
  contornando a factory `rehydrate()` pedida no enunciado.

### Opção 3 — TypeORM

- Bom, porque é amplamente conhecido.
- Ruim, porque não possui Unit of Work / Identity Map nativos e não é a opção preferencial do desafio.

## Referências

- [RFC-0001 — Stack tecnológica, scaffolding hexagonal e topologia de execução](../rfc/RFC-0001-stack-scaffolding-e-topologia.md)
- MikroORM EntitySchema docs: https://mikro-orm.io/docs/entity-schema

