---
status: Accepted
date: 2026-10-22
deciders: [Ulysses Andrade Leal]
rfc: RFC-0002
---

# ADR-0009 — Garantir invariantes financeiras no schema PostgreSQL combinando FKs compostas, partial unique indexes e triggers

## Contexto e problema

A seção 5 (restrição 9) do desafio determina que as garantias de unicidade, imutabilidade e não-negatividade da
seção 6 devem ser aplicadas **no schema do banco**, não apenas no código da aplicação. Ao mesmo tempo, a seção 7
determina que operações inválidas sob regras de negócio (como saldo insuficiente, moeda incompatível, tentativa
de reverter transação de outro contexto ou valor divergente) resultem em transações persistidas como `REJECTED`
com `failureCode` auditável e publicação de `WagerTransactionRejected`.

Se colocássemos uma FK composta incondicional em `wager_transactions (wallet_id, player_id, currency) REFERENCES
wallets (id, player_id, currency)`, uma tentativa inválida com moeda divergente causaria erro de FK no `INSERT` e
**impediria** persistir a transação com `status = 'REJECTED'` e `failure_code = 'CURRENCY_MISMATCH'`.

## Drivers da decisão

- Garantir 100% das invariantes financeiras diretamente no PostgreSQL.
- Permitir que transações `REJECTED` sejam persistidas para auditoria, replay idempotente e emissão de evento na
  outbox.
- Impedir sob qualquer hipótese que uma transação `PROCESSED` viole moeda/player da wallet, reverta duas vezes a
  mesma operação, altere uma transação terminal ou corrompa a cadeia do ledger.

## Opções consideradas

1. **Defesa em camadas no PostgreSQL: FKs compostas + `UNIQUE (wallet_id, wallet_version)` + `CHECK` aritmética no
   ledger + partial unique index para reversão única + triggers para imutabilidade do ledger e validação de
   transações `PROCESSED`/terminais**
2. **Apenas constraints declarativas simples (`PK`, `FK` simples e `CHECK >= 0`), deixando o restante no código**
3. **FKs compostas incondicionais em `wager_transactions`, rejeitando erros de contexto sem gravar linha `REJECTED`**

## Decisão

Escolhemos a **Opção 1**, estruturando as garantias no PostgreSQL em quatro mecanismos complementares:

1. **Constraints declarativas e FKs compostas em `wallets` e `wallet_ledger_entries`**:
   - `uq_wallets__player_currency UNIQUE (player_id, currency)`;
   - `ck_wallets__balance_non_negative CHECK (balance >= 0)`;
   - `fk_wallet_ledger_entries__wallet_currency FOREIGN KEY (wallet_id, currency) REFERENCES wallets (id, currency)`;
   - `fk_wallet_ledger_entries__transaction_wallet_currency FOREIGN KEY (transaction_id, wallet_id, currency) REFERENCES wager_transactions (id, wallet_id, currency)`;
   - `uq_wallet_ledger_entries__transaction UNIQUE (transaction_id)`;
   - `uq_wallet_ledger_entries__wallet_version UNIQUE (wallet_id, wallet_version)`;
   - `ck_wallet_ledger_entries__balanced_arithmetic` validando `balance_after = balance_before ± amount`.
2. **Partial Unique Index para reversão única**:
   - `uq_wager_transactions__single_reversal ON wager_transactions (reference_transaction_id) WHERE kind IN ('REFUND', 'ROLLBACK') AND status = 'PROCESSED'`.
3. **Triggers em `wallet_ledger_entries`**:
   - `trg_wallet_ledger_entries__immutable`: bloqueia qualquer `UPDATE` ou `DELETE` (`ERRCODE = '55000'`);
   - `trg_wallet_ledger_entries__validate_tx`: impede inserção no ledger se a transação não estiver `PROCESSED` ou
     se for `LOSS`.
4. **Trigger `trg_wager_transactions__guard` em `wager_transactions`**:
   - Bloqueia qualquer `UPDATE` quando `OLD.status IN ('PROCESSED', 'REJECTED', 'FAILED')` ou quando colunas de
     identidade do negócio são alteradas;
   - Quando `NEW.status = 'PROCESSED'`, exige correspondência exata de `(player_id, currency)` com a `wallet` e,
     para `REFUND`/`ROLLBACK`, exige que a transação referenciada esteja `PROCESSED` e tenha o mesmo
     `(provider_id, wallet_id, player_id, round_id, currency, amount)` e `kind` compatível.

## Consequências

### Positivas

- Nenhuma falha na camada de aplicação consegue corromper saldo, criar lançamento órfão, alterar o ledger,
  reverter duas vezes uma aposta ou mudar uma transação finalizada.
- Transações rejeitadas por regra de negócio (`status = 'REJECTED'`) continuam podendo ser gravadas em
  `wager_transactions` com seu `failure_code` e `recorded_balance`.

### Negativas / trade-offs

- Dois triggers PL/pgSQL adicionais na migration inicial. O custo por transação é mínimo (leituras por PK que já
  estão no buffer cache da mesma transação SQL) e amplamente justificado pela segurança financeira.

### Como validar

- Os 20 testes de integração em `test/integration/schema/schema-constraints.spec.ts` exercitam cada constraint e
  trigger individualmente contra o PostgreSQL real.

## Referências

- [RFC-0002 — Modelagem de dados, design de relacionamentos e invariantes no schema PostgreSQL](../rfc/RFC-0002-modelagem-de-dados-e-relacionamentos.md)
- Seções 5, 6 e 7 de [docs/challenge/CHALLENGE.md](../challenge/CHALLENGE.md)

