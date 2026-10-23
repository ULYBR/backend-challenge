---
status: Accepted
date: 2026-10-22
deciders: [Ulysses Andrade Leal]
rfc: RFC-0001
---

# ADR-0004 — Gerar identificadores internos com UUIDv7 na aplicação

## Contexto e problema

As entidades `Wallet`, `WagerTransaction`, `WalletLedgerEntry` e `OutboxMessage` (bem como `eventId` e
`correlationId`) usam UUIDs como chave primária (conforme exemplos da seção 9 do desafio, ex.:
`0192f291-27dd-7d3f-8071-5f8685deef37`, que já são UUIDv7). Precisamos decidir a versão de UUID e onde ele é
gerado.

## Drivers da decisão

- Localidade de índice B-tree em tabelas append-only de escrita intensa (`wallet_ledger_entries`,
  `wager_transactions`, `outbox_messages`).
- Capacidade de instanciar entidades de domínio completas antes de persistir no banco.
- Ordenação determinística de desempate para paginação por cursor no ledger (`created_at, id`).

## Opções consideradas

1. **UUIDv7 gerado na aplicação via `Bun.randomUUIDv7()` (atrás da porta `IdGenerator`)**
2. **UUIDv4 gerado na aplicação (`crypto.randomUUID()`)**
3. **UUID gerado pelo PostgreSQL (`gen_random_uuid()`) no `INSERT`**

## Decisão

Escolhemos a **Opção 1**: todos os identificadores internos são **UUIDv7** (RFC 9562), gerados na aplicação por
meio da porta `IdGenerator` (cuja implementação padrão delega para `Bun.randomUUIDv7()`).

## Consequências

### Positivas

- Inserções em `wallets`, `wager_transactions`, `wallet_ledger_entries` e `outbox_messages` ocorrem no final do
  índice B-tree, reduzindo page splits e contenção de buffer sob concorrência.
- A aplicação conhece o `id` da transação, do lançamento de ledger e do evento de outbox no momento em que
  constrói as entidades em memória, antes do `flush`.
- Em testes de unidade, `IdGenerator` pode ser determinístico.

### Negativas / trade-offs

- UUIDv7 codifica o timestamp em milissegundos nos primeiros 48 bits, revelando o instante aproximado de criação
  do recurso (aceitável e desejável para transações financeiras internas).

### Como validar

- Teste unitário do `UuidV7Generator` verifica o formato RFC 9562 (`version = 7`) e a monotonicidade.

## Referências

- RFC 9562 (UUIDv7): https://datatracker.ietf.org/doc/html/rfc9562
- Exemplo de ID no próprio enunciado (seção 9): `0192f291-27dd-7d3f-8071-5f8685deef37`

