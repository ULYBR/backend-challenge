---
status: Accepted
date: 2026-10-22
deciders: [Ulysses Andrade Leal]
rfc: RFC-0004
---

# ADR-0011 — Usar lock pessimista por wallet (SELECT FOR UPDATE) com defesa em profundidade e suporte a auto-scaling

## Contexto e problema

A seção 8 do desafio estabelece que a **unidade de concorrência é a `walletId`** e exige correção quando duas
apostas disputam o mesmo saldo (`100 / 80 / 80`), quando a mesma aposta é enviada **50 vezes em paralelo**,
quando wallets distintas são processadas simultaneamente e quando **3 ou mais instâncias** rodam em paralelo
(inclusive sob auto-scaling horizontal).

## Drivers da decisão

- Zero *lost updates* e zero possibilidade de saldo negativo sob corrida.
- Paralelismo total entre carteiras distintas (proibido lock global).
- Previsibilidade sob *hot wallet* (evitar tempestade de retries de lock otimista quando 50 requisições atingem a
  mesma carteira ao mesmo tempo).
- Compatibilidade com múltiplas réplicas em auto-scaling (ECS / Kubernetes + RDS Proxy / PgBouncer).

## Opções consideradas

1. **Lock pessimista na linha da wallet (`SELECT ... FROM wallets WHERE id = $1 FOR UPDATE`) em transação
   `READ COMMITTED` com `SET LOCAL lock_timeout`, combinado com verificação de `version` no `UPDATE` e
   constraints no banco**
2. **Lock otimista puro (`UPDATE wallets ... WHERE id = $1 AND version = $2`) com loop de retry na aplicação**
3. **Advisory locks do PostgreSQL (`pg_advisory_xact_lock`)**

## Decisão

Escolhemos a **Opção 1**:

- Toda operação de escrita em carteira abre uma transação SQL (`READ COMMITTED`), define
  `SET LOCAL lock_timeout = '5000ms'` e executa `SELECT * FROM wallets WHERE id = $walletId FOR UPDATE` como
  primeiro passo.
- Após adquirir o lock da carteira, verifica a existência de `(providerId, idempotencyKey)`: como transações
  concorrentes anteriores na mesma carteira já fizeram commit antes de liberar o lock, o estado lido em
  `READ COMMITTED` é imediatamente atualizado.
- Como defesa em profundidade, o `UPDATE wallets` inclui `WHERE id = $walletId AND version = $expectedVersion` e
  o banco impõe `ck_wallets__balance_non_negative` e `uq_wallet_ledger_entries__wallet_version`.

## Consequências

### Positivas

- Em *hot wallet* (ex.: 50 requisições concorrentes), as transações enfileiram-se ordenadamente no lock da linha
  no PostgreSQL e completam em poucos milissegundos sem tempestade de rollbacks.
- Carteiras diferentes (`walletId` distintos) nunca bloqueiam umas às outras.
- Funciona identicamente com 1, 3 ou 50 instâncias em auto-scaling, inclusive atrás de RDS Proxy / PgBouncer em
  modo `transaction` (pois o lock e o `SET LOCAL` vivem apenas dentro do bloco `BEGIN ... COMMIT`).

### Negativas / trade-offs

- Mantém uma conexão do pool ocupada enquanto aguarda o lock da carteira quente. Mitigado por transações curtas
  (zero I/O de rede externo dentro da transação SQL, pois eventos vão para a tabela `outbox_messages`) e por
  `SET LOCAL lock_timeout`.

### Como validar

- Testes em `test/concurrency/` validando o cenário `100 / 80 / 80` e `50×` em paralelo sem duplicação nem saldo
  negativo.

## Referências

- [RFC-0004 — Pipeline de processamento de apostas, concorrência por wallet e idempotência persistente](../rfc/RFC-0004-pipeline-de-processamento-concorrencia-e-idempotencia.md)

