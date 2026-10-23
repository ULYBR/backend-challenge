---
rfc: RFC-0009
title: Suíte completa de concorrência multi-instância (8 cenários da Seção 13) e benchmark de carga
status: Implemented
author: Ulysses Andrade Leal
created: 2026-10-22
updated: 2026-10-22
phase: 11
adrs: [ADR-0021]
---

# RFC-0009 — Suíte completa de concorrência multi-instância (8 cenários da Seção 13) e benchmark de carga

## 1. Resumo

Especifica a suíte consolidada de concorrência (`test/concurrency/mandatory-8-scenarios.spec.ts`) que exercita os **8 cenários obrigatórios da Seção 13** com **≥ 3 instâncias simultâneas** da aplicação conectadas ao PostgreSQL 17 e ao MiniStack SQS reais, bem como o benchmark reproduzível de carga (`scripts/load-test.ts`, exposto via `bun run test:load`) exigido como diferencial na Seção 14.

## 2. Os 8 Cenários Obrigatórios (Seção 13)

| # | Cenário | Mecanismo Verificado | Invariante Final |
|---|---|---|---|
| 1 | Mesma aposta enviada **50 vezes em paralelo** distribuída entre 3 instâncias HTTP | `SELECT ... FOR UPDATE` + `uq_wager_transactions__provider_external_tx` + replay idempotente | 1 único débito, 1 `WalletLedgerEntry`, 49 respostas `idempotentReplay: true` |
| 2 | Operações concorrentes disputando saldo da mesma *hot wallet* (`100/80/80` + 20 apostas concorrentes) | Lock pessimista por `walletId` + `ck_wallets__balance_non_negative` | Saldo nunca negativo; exatamente as apostas que cabem no saldo são `PROCESSED` e as demais `REJECTED (INSUFFICIENT_FUNDS)` |
| 3 | 15 carteiras distintas processadas em paralelo em múltiplas rodadas | Lock granular por linha (`WHERE id = $1 FOR UPDATE`), zero lock global | Todas as 15 carteiras processam sem bloqueio mútuo |
| 4 | **≥ 3 instâncias simultâneas** (`instance-1`, `instance-2`, `instance-3`) recebendo tráfego HTTP e SQS concorrente | Statelessness total (`APP_ROLE`) + coordenação via PostgreSQL e SQS | Consistência contábil perfeita entre instâncias |
| 5 | Worker morto **depois do commit e antes do ack** | Transação SQL com `inbox_messages` confirmada, falha simulada antes do `DeleteMessage`, reentrega processada pela instância 2 | Zero duplo débito; reentrega reconhecida via Inbox e removida da fila |
| 6 | Múltiplos publishers concorrentes sobre a mesma `outbox_messages` | `FOR UPDATE SKIP LOCKED` + lease (`locked_by`, `locked_until`) | Todos os eventos publicados em `wallet-events.fifo`, `countUnpublished() === 0` |
| 7 | `ROLLBACK` e `REFUND` entregues antes da `BET` referenciada sob concorrência | `PENDING_REFERENCE` + `PendingReferenceWorker` + lock por carteira | Reversões aplicadas após chegada da `BET`, saldo final restaurado |
| 8 | Reinício completo do serviço (*cold restart*) após carga mista e comprovação da consistência final | Encerramento das 3 instâncias, bootstrap de uma 4ª instância de recuperação, drenagem de Outbox/PendingReference e reconciliação completa | `wallet.balance == saldo reconstruído pelo ledger` em 100% das carteiras |

## 3. Teste de Carga (`bun run test:load`)

O script `scripts/load-test.ts` sobe instâncias reais da API e executa um experimento controlado de carga mista (70% carteiras distribuídas, 20% contenção em *hot wallet*, 10% replays idempotentes), medindo e imprimindo em tabela Markdown:
- Throughput (`req/s`), latências `p50`, `p95`, `p99` e `max`;
- Contagem de transações por status (`PROCESSED`, `REJECTED`, `idempotentReplay`);
- Conflitos de concorrência, outbox lag e reconciliação final de 100% das carteiras.

