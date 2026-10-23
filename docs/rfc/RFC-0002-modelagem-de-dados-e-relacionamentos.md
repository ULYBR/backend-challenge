---
rfc: RFC-0002
title: Modelagem de dados, design de relacionamentos e invariantes no schema PostgreSQL
status: Implemented
author: Ulysses Andrade Leal
created: 2026-10-22
updated: 2026-10-22
phase: 2
adrs: [ADR-0007, ADR-0008, ADR-0009]
---

# RFC-0002 — Modelagem de dados, design de relacionamentos e invariantes no schema PostgreSQL

## 1. Resumo

Especifica o modelo relacional completo no PostgreSQL 17 para as cinco tabelas do domínio (`wallets`,
`wager_transactions`, `wallet_ledger_entries`, `inbox_messages`, `outbox_messages`), seus relacionamentos,
chaves compostas, `CHECK` constraints, partial unique indexes e triggers de imutabilidade/estado. O objetivo é
atender rigorosamente à restrição inviolável nº 9 do desafio: **todas as garantias de unicidade, imutabilidade e
não-negatividade são impostas diretamente pelo schema do banco**, além do modelo de domínio.

## 2. Contexto e motivação

O enunciado ([docs/challenge/CHALLENGE.md](../challenge/CHALLENGE.md)) define:

- **Seção 5 (Restrição 9)**: *"As garantias de unicidade, imutabilidade e não-negatividade descritas na seção 6
  devem ser aplicadas **no schema do banco**, não apenas em código de aplicação. O desenho do schema, das
  constraints e dos índices é parte do que está sendo avaliado."*
- **Seção 6.1 (`Money`)**: representação exata com escala fixa de 2 casas decimais; proibição absoluta de
  `number`/`float`/`double`.
- **Seção 6.2 (`Wallet`)**: no máximo uma wallet por `(playerId, currency)`; saldo nunca negativo; toda mudança
  de saldo possui lançamento correspondente no ledger; `version` inicia em 1 e incrementa somente quando o saldo
  muda; moeda da operação igual à da wallet.
- **Seção 6.3 (`WagerTransaction`)**: estados terminais (`PROCESSED`, `REJECTED`, `FAILED`) nunca sofrem nova
  transição; `OPENING` é exclusivo de uso interno; idempotência persistente.
- **Seção 6.4 (`WalletLedgerEntry`)**: estritamente imutável (append-only, sem `UPDATE`/`DELETE`); no máximo um
  lançamento por transação; `balanceBefore ± amount === balanceAfter`; transações sem efeito no saldo (`LOSS`,
  `REJECTED`) não geram lançamento.
- **Seção 6.5 (`InboxMessage` e `OutboxMessage`)**: deduplicação por `(consumerName, messageId)` e publicação
  transacional com suporte a múltiplos workers concorrentes.
- **Seção 7 (Regras de negócio)**: `REFUND` e `ROLLBACK` exigem `referenceExternalTransactionId`; referência
  pertence ao mesmo provider, player, wallet, moeda e rodada; no máximo uma reversão efetiva por transação
  referenciada (decisão D2 do [ROADMAP](../ROADMAP.md)); valor da reversão igual ao da referência; replay de
  operação já processada retorna o resultado original incluindo o saldo observado naquele momento (`recorded_balance`).

## 3. Objetivos e não-objetivos

**Objetivos**

- Definir o DDL SQL exato (`up` e `down`) da migration inicial.
- Garantir que todas as invariantes estruturais, aritméticas e de transição de estado tenham proteção no
  PostgreSQL (constraints declarativas + triggers cirúrgicos).
- Permitir que transações rejeitadas por regra de negócio (`status = 'REJECTED'`) sejam persistidas e auditadas
  com seu `failure_code` e `recorded_balance`, enquanto transações `PROCESSED` têm integridade referencial e
  monetária validada pelo próprio banco.
- Projetar índices voltados para os caminhos críticos de consulta e concorrência (lock por wallet, lookup de
  idempotência, paginação por cursor do ledger, polling de outbox com `SKIP LOCKED`, worker de
  `PENDING_REFERENCE`).

**Não-objetivos**

- Implementar a lógica dos casos de uso (Fase 4).
- Implementar ledger de partidas dobradas contábeis (*double-entry*), listado como diferencial opcional na seção
  6.4; o modelo de `wallet_ledger_entries` com `direction` + `balance_before`/`balance_after` verificados por
  constraint já provê trilha de auditoria completa e linear por versão da wallet.

## 4. Desenho proposto

### 4.1 Visão de Relacionamentos

O diagrama ER detalhado encontra-se em [docs/diagrams/er-diagram.md](../diagrams/er-diagram.md).

Principais decisões de relacionamento:

1. **Chaves compostas em `wallets` para integridade cruzada**:
   - `uq_wallets__player_currency UNIQUE (player_id, currency)` garante no máximo 1 wallet por jogador e moeda.
   - `uq_wallets__id_currency UNIQUE (id, currency)` permite que `wallet_ledger_entries` declare uma **FK
     composta** `(wallet_id, currency) REFERENCES wallets (id, currency)`, tornando impossível no banco inserir
     um lançamento de ledger em moeda diferente da wallet.
2. **Relacionamento `wager_transactions` ↔ `wallet_ledger_entries` (1:0..1)**:
   - `wager_transactions` expõe `uq_wager_transactions__id_wallet_currency UNIQUE (id, wallet_id, currency)`.
   - `wallet_ledger_entries` declara:
     - `uq_wallet_ledger_entries__transaction UNIQUE (transaction_id)` → no máximo 1 lançamento por transação.
     - `fk_wallet_ledger_entries__transaction FOREIGN KEY (transaction_id, wallet_id, currency) REFERENCES wager_transactions (id, wallet_id, currency)` → garante que o lançamento aponta para a mesma wallet e moeda da transação.
3. **Cadeia linear de versões no ledger**:
   - `uq_wallet_ledger_entries__wallet_version UNIQUE (wallet_id, wallet_version)` garante que cada incremento de
     `wallets.version` produz exatamente um lançamento e impede *lost updates* mesmo que duas transações tentem
     gravar a mesma versão.
4. **Auto-relacionamento em `wager_transactions` (`reference_transaction_id`)**:
   - `fk_wager_transactions__reference FOREIGN KEY (reference_transaction_id) REFERENCES wager_transactions (id)`.
   - Um **partial unique index** `uq_wager_transactions__single_reversal ON wager_transactions (reference_transaction_id) WHERE kind IN ('REFUND', 'ROLLBACK') AND status = 'PROCESSED'` garante no nível de índice que nenhuma transação pode ser revertida mais de uma vez (decisão D2).
   - O trigger `trg_wager_transactions__guard` valida que, ao transicionar para `PROCESSED`, a transação
     referenciada pertence ao mesmo `(provider_id, wallet_id, player_id, round_id, currency)`, está `PROCESSED`,
     tem o `kind` compatível (`BET` para `REFUND`; `BET|WIN|REFUND` para `ROLLBACK`) e possui exatamente o mesmo
     `amount`.

### 4.2 Especificação DDL das Tabelas

#### 4.2.1 Tabela `wallets`

```sql
CREATE TABLE wallets (
  id          UUID            NOT NULL,
  player_id   UUID            NOT NULL,
  currency    CHAR(3)         NOT NULL,
  balance     NUMERIC(19, 2) NOT NULL,
  version     INTEGER         NOT NULL,
  created_at  TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ    NOT NULL DEFAULT now(),

  CONSTRAINT pk_wallets PRIMARY KEY (id),
  CONSTRAINT uq_wallets__player_currency UNIQUE (player_id, currency),
  CONSTRAINT uq_wallets__id_currency UNIQUE (id, currency),
  CONSTRAINT ck_wallets__currency_iso CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT ck_wallets__balance_non_negative CHECK (balance >= 0),
  CONSTRAINT ck_wallets__version_positive CHECK (version >= 1)
);
```

#### 4.2.2 Tabela `wager_transactions`

```sql
CREATE TABLE wager_transactions (
  id                                UUID           NOT NULL,
  provider_id                       TEXT           NOT NULL,
  external_transaction_id           TEXT           NOT NULL,
  idempotency_key                   TEXT           NOT NULL,
  payload_hash                      CHAR(64)       NOT NULL,
  wallet_id                         UUID           NOT NULL,
  player_id                         UUID           NOT NULL,
  round_id                          TEXT           NOT NULL,
  game_id                           TEXT           NOT NULL,
  kind                              TEXT           NOT NULL,
  amount                            NUMERIC(19, 2) NOT NULL,
  currency                          CHAR(3)        NOT NULL,
  reference_external_transaction_id TEXT           NULL,
  reference_transaction_id          UUID           NULL,
  status                            TEXT           NOT NULL,
  failure_code                      TEXT           NULL,
  recorded_balance                  NUMERIC(19, 2) NULL,
  reference_attempts                INTEGER        NOT NULL DEFAULT 0,
  next_reference_attempt_at         TIMESTAMPTZ    NULL,
  created_at                        TIMESTAMPTZ    NOT NULL DEFAULT now(),
  processed_at                      TIMESTAMPTZ    NULL,
  updated_at                        TIMESTAMPTZ    NOT NULL DEFAULT now(),

  CONSTRAINT pk_wager_transactions PRIMARY KEY (id),
  CONSTRAINT uq_wager_transactions__provider_external_tx
    UNIQUE (provider_id, external_transaction_id),
  CONSTRAINT uq_wager_transactions__provider_idempotency_key
    UNIQUE (provider_id, idempotency_key),
  CONSTRAINT uq_wager_transactions__id_wallet_currency
    UNIQUE (id, wallet_id, currency),

  CONSTRAINT fk_wager_transactions__wallet
    FOREIGN KEY (wallet_id) REFERENCES wallets (id) ON DELETE RESTRICT,
  CONSTRAINT fk_wager_transactions__reference
    FOREIGN KEY (reference_transaction_id) REFERENCES wager_transactions (id) ON DELETE RESTRICT,

  CONSTRAINT ck_wager_transactions__provider_non_empty
    CHECK (btrim(provider_id) <> ''),
  CONSTRAINT ck_wager_transactions__external_tx_non_empty
    CHECK (btrim(external_transaction_id) <> ''),
  CONSTRAINT ck_wager_transactions__idempotency_key_non_empty
    CHECK (btrim(idempotency_key) <> ''),
  CONSTRAINT ck_wager_transactions__payload_hash_hex
    CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_wager_transactions__round_non_empty
    CHECK (btrim(round_id) <> ''),
  CONSTRAINT ck_wager_transactions__game_non_empty
    CHECK (btrim(game_id) <> ''),
  CONSTRAINT ck_wager_transactions__kind_enum
    CHECK (kind IN ('OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK')),
  CONSTRAINT ck_wager_transactions__opening_internal_only
    CHECK ((kind = 'OPENING') = (provider_id = '__internal__')),
  CONSTRAINT ck_wager_transactions__amount_positive
    CHECK (amount > 0),
  CONSTRAINT ck_wager_transactions__currency_iso
    CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT ck_wager_transactions__status_enum
    CHECK (status IN ('PENDING', 'PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED')),
  CONSTRAINT ck_wager_transactions__reference_required_for_reversal
    CHECK (
      kind NOT IN ('REFUND', 'ROLLBACK')
      OR (reference_external_transaction_id IS NOT NULL AND btrim(reference_external_transaction_id) <> '')
    ),
  CONSTRAINT ck_wager_transactions__processed_reversal_has_resolved_ref
    CHECK (
      status <> 'PROCESSED'
      OR kind NOT IN ('REFUND', 'ROLLBACK')
      OR reference_transaction_id IS NOT NULL
    ),
  CONSTRAINT ck_wager_transactions__failure_code_iff_failed_or_rejected
    CHECK (
      (status IN ('REJECTED', 'FAILED') AND failure_code IS NOT NULL AND btrim(failure_code) <> '')
      OR (status NOT IN ('REJECTED', 'FAILED') AND failure_code IS NULL)
    ),
  CONSTRAINT ck_wager_transactions__processed_at_iff_terminal
    CHECK (
      (status IN ('PROCESSED', 'REJECTED', 'FAILED') AND processed_at IS NOT NULL)
      OR (status IN ('PENDING', 'PENDING_REFERENCE') AND processed_at IS NULL)
    ),
  CONSTRAINT ck_wager_transactions__recorded_balance_non_negative
    CHECK (recorded_balance IS NULL OR recorded_balance >= 0),
  CONSTRAINT ck_wager_transactions__reference_attempts_non_negative
    CHECK (reference_attempts >= 0)
);

-- No máximo uma reversão efetiva (REFUND ou ROLLBACK) por transação referenciada
CREATE UNIQUE INDEX uq_wager_transactions__single_reversal
  ON wager_transactions (reference_transaction_id)
  WHERE kind IN ('REFUND', 'ROLLBACK') AND status = 'PROCESSED';

-- Índice parcial para o worker agendado de PENDING_REFERENCE
CREATE INDEX ix_wager_transactions__pending_reference_due
  ON wager_transactions (next_reference_attempt_at ASC)
  WHERE status = 'PENDING_REFERENCE';

-- Índice de busca por wallet e histórico
CREATE INDEX ix_wager_transactions__wallet_created
  ON wager_transactions (wallet_id, created_at DESC);
```

#### 4.2.3 Tabela `wallet_ledger_entries`

```sql
CREATE TABLE wallet_ledger_entries (
  id              UUID           NOT NULL,
  wallet_id       UUID           NOT NULL,
  transaction_id  UUID           NOT NULL,
  wallet_version  INTEGER        NOT NULL,
  direction       TEXT           NOT NULL,
  amount          NUMERIC(19, 2) NOT NULL,
  currency        CHAR(3)        NOT NULL,
  balance_before  NUMERIC(19, 2) NOT NULL,
  balance_after   NUMERIC(19, 2) NOT NULL,
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT now(),

  CONSTRAINT pk_wallet_ledger_entries PRIMARY KEY (id),
  CONSTRAINT uq_wallet_ledger_entries__transaction UNIQUE (transaction_id),
  CONSTRAINT uq_wallet_ledger_entries__wallet_version UNIQUE (wallet_id, wallet_version),

  CONSTRAINT fk_wallet_ledger_entries__wallet_currency
    FOREIGN KEY (wallet_id, currency)
    REFERENCES wallets (id, currency) ON DELETE RESTRICT,
  CONSTRAINT fk_wallet_ledger_entries__transaction_wallet_currency
    FOREIGN KEY (transaction_id, wallet_id, currency)
    REFERENCES wager_transactions (id, wallet_id, currency) ON DELETE RESTRICT,

  CONSTRAINT ck_wallet_ledger_entries__wallet_version_positive
    CHECK (wallet_version >= 1),
  CONSTRAINT ck_wallet_ledger_entries__direction_enum
    CHECK (direction IN ('DEBIT', 'CREDIT')),
  CONSTRAINT ck_wallet_ledger_entries__amount_positive
    CHECK (amount > 0),
  CONSTRAINT ck_wallet_ledger_entries__currency_iso
    CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT ck_wallet_ledger_entries__balance_before_non_negative
    CHECK (balance_before >= 0),
  CONSTRAINT ck_wallet_ledger_entries__balance_after_non_negative
    CHECK (balance_after >= 0),
  CONSTRAINT ck_wallet_ledger_entries__balanced_arithmetic
    CHECK (
      (direction = 'CREDIT' AND balance_after = balance_before + amount)
      OR (direction = 'DEBIT' AND balance_after = balance_before - amount)
    )
);

-- Índice para paginação estável por cursor (created_at, id) e reconciliação
CREATE INDEX ix_wallet_ledger_entries__wallet_cursor
  ON wallet_ledger_entries (wallet_id, created_at ASC, id ASC);
```

#### 4.2.4 Tabela `inbox_messages`

```sql
CREATE TABLE inbox_messages (
  consumer_name TEXT        NOT NULL,
  message_id    TEXT        NOT NULL,
  payload_hash  CHAR(64)    NOT NULL,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at  TIMESTAMPTZ NULL,

  CONSTRAINT pk_inbox_messages PRIMARY KEY (consumer_name, message_id),
  CONSTRAINT ck_inbox_messages__consumer_non_empty CHECK (btrim(consumer_name) <> ''),
  CONSTRAINT ck_inbox_messages__message_id_non_empty CHECK (btrim(message_id) <> ''),
  CONSTRAINT ck_inbox_messages__payload_hash_hex CHECK (payload_hash ~ '^[0-9a-f]{64}$')
);
```

#### 4.2.5 Tabela `outbox_messages`

```sql
CREATE TABLE outbox_messages (
  id              UUID        NOT NULL,
  aggregate_type  TEXT        NOT NULL,
  aggregate_id    UUID        NOT NULL,
  event_type      TEXT        NOT NULL,
  event_version   INTEGER     NOT NULL DEFAULT 1,
  correlation_id  UUID        NOT NULL,
  causation_id    UUID        NULL,
  payload         JSONB       NOT NULL,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts        INTEGER     NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until    TIMESTAMPTZ NULL,
  locked_by       TEXT        NULL,
  published_at    TIMESTAMPTZ NULL,
  last_error      TEXT        NULL,

  CONSTRAINT pk_outbox_messages PRIMARY KEY (id),
  CONSTRAINT ck_outbox_messages__event_version_positive CHECK (event_version >= 1),
  CONSTRAINT ck_outbox_messages__attempts_non_negative CHECK (attempts >= 0),
  CONSTRAINT ck_outbox_messages__payload_is_object CHECK (jsonb_typeof(payload) = 'object')
);

-- Índice parcial para polling concorrente com FOR UPDATE SKIP LOCKED
CREATE INDEX ix_outbox_messages__pending_due
  ON outbox_messages (next_attempt_at ASC, occurred_at ASC)
  WHERE published_at IS NULL;
```

### 4.3 Triggers de Imutabilidade e Consistência Semântica no Banco

Para cobrir as invariantes que cruzam linhas ou proíbem mutação pós-estado terminal:

#### 4.3.1 Imutabilidade absoluta de `wallet_ledger_entries` (+ validação contra a transação)

```sql
-- 1. Proíbe qualquer UPDATE ou DELETE em wallet_ledger_entries
CREATE OR REPLACE FUNCTION fn_wallet_ledger_entries_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'wallet_ledger_entries is append-only: % is prohibited', TG_OP
    USING ERRCODE = '55000', CONSTRAINT = 'trg_wallet_ledger_entries__immutable';
END;
$$;

CREATE TRIGGER trg_wallet_ledger_entries__immutable
  BEFORE UPDATE OR DELETE ON wallet_ledger_entries
  FOR EACH ROW
  EXECUTE FUNCTION fn_wallet_ledger_entries_immutable();

-- 2. Garante que LOSS e transações não-PROCESSED jamais gerem lançamento no ledger
CREATE OR REPLACE FUNCTION fn_wallet_ledger_entries_validate_tx()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_kind   TEXT;
  v_status TEXT;
BEGIN
  SELECT kind, status
    INTO v_kind, v_status
    FROM wager_transactions
   WHERE id = NEW.transaction_id;

  IF v_status <> 'PROCESSED' THEN
    RAISE EXCEPTION 'Ledger entry requires PROCESSED transaction (got %)', v_status
      USING ERRCODE = '23514', CONSTRAINT = 'trg_wallet_ledger_entries__validate_tx';
  END IF;

  IF v_kind = 'LOSS' THEN
    RAISE EXCEPTION 'LOSS transaction cannot generate ledger entry'
      USING ERRCODE = '23514', CONSTRAINT = 'trg_wallet_ledger_entries__validate_tx';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_wallet_ledger_entries__validate_tx
  BEFORE INSERT ON wallet_ledger_entries
  FOR EACH ROW
  EXECUTE FUNCTION fn_wallet_ledger_entries_validate_tx();
```

#### 4.3.2 Guarda de transições terminais e integridade de referência em `wager_transactions`

```sql
CREATE OR REPLACE FUNCTION fn_wager_transactions_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_wallet_player   UUID;
  v_wallet_currency CHAR(3);
  v_ref             RECORD;
BEGIN
  -- 1. Em UPDATE: bloquear qualquer mutação se o estado anterior já era terminal
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status IN ('PROCESSED', 'REJECTED', 'FAILED') THEN
      RAISE EXCEPTION 'Cannot mutate terminal wager_transaction (id=%, status=%)', OLD.id, OLD.status
        USING ERRCODE = '55000', CONSTRAINT = 'trg_wager_transactions__terminal_immutable';
    END IF;

    -- Colunas de identidade do negócio jamais mudam em UPDATE
    IF NEW.provider_id <> OLD.provider_id
       OR NEW.external_transaction_id <> OLD.external_transaction_id
       OR NEW.idempotency_key <> OLD.idempotency_key
       OR NEW.payload_hash <> OLD.payload_hash
       OR NEW.wallet_id <> OLD.wallet_id
       OR NEW.player_id <> OLD.player_id
       OR NEW.round_id <> OLD.round_id
       OR NEW.game_id <> OLD.game_id
       OR NEW.kind <> OLD.kind
       OR NEW.amount <> OLD.amount
       OR NEW.currency <> OLD.currency
       OR NEW.reference_external_transaction_id IS DISTINCT FROM OLD.reference_external_transaction_id
    THEN
      RAISE EXCEPTION 'Cannot mutate immutable business columns of wager_transaction (id=%)', OLD.id
        USING ERRCODE = '55000', CONSTRAINT = 'trg_wager_transactions__business_columns_immutable';
    END IF;
  END IF;

  -- 2. Se status = PROCESSED, validar correspondência com a wallet e com a referência
  IF NEW.status = 'PROCESSED' THEN
    SELECT player_id, currency
      INTO v_wallet_player, v_wallet_currency
      FROM wallets
     WHERE id = NEW.wallet_id;

    IF v_wallet_player <> NEW.player_id OR v_wallet_currency <> NEW.currency THEN
      RAISE EXCEPTION 'PROCESSED transaction must match wallet player_id and currency'
        USING ERRCODE = '23514', CONSTRAINT = 'trg_wager_transactions__wallet_context_match';
    END IF;

    IF NEW.kind IN ('REFUND', 'ROLLBACK') THEN
      SELECT id, provider_id, wallet_id, player_id, round_id, kind, amount, currency, status
        INTO v_ref
        FROM wager_transactions
       WHERE id = NEW.reference_transaction_id;

      IF NOT FOUND OR v_ref.status <> 'PROCESSED' THEN
        RAISE EXCEPTION 'Referenced transaction must exist and be PROCESSED'
          USING ERRCODE = '23514', CONSTRAINT = 'trg_wager_transactions__reference_valid';
      END IF;

      IF v_ref.provider_id <> NEW.provider_id
         OR v_ref.wallet_id <> NEW.wallet_id
         OR v_ref.player_id <> NEW.player_id
         OR v_ref.round_id <> NEW.round_id
         OR v_ref.currency <> NEW.currency
         OR v_ref.amount <> NEW.amount
      THEN
        RAISE EXCEPTION 'Referenced transaction context or amount mismatch'
          USING ERRCODE = '23514', CONSTRAINT = 'trg_wager_transactions__reference_context_match';
      END IF;

      IF (NEW.kind = 'REFUND' AND v_ref.kind <> 'BET')
         OR (NEW.kind = 'ROLLBACK' AND v_ref.kind NOT IN ('BET', 'WIN', 'REFUND'))
      THEN
        RAISE EXCEPTION 'Invalid referenced transaction kind (%) for %', v_ref.kind, NEW.kind
          USING ERRCODE = '23514', CONSTRAINT = 'trg_wager_transactions__reference_kind_valid';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_wager_transactions__guard
  BEFORE INSERT OR UPDATE ON wager_transactions
  FOR EACH ROW
  EXECUTE FUNCTION fn_wager_transactions_guard();
```

## 5. Invariantes e garantias (Mapa Invariante → Constraint)

| # | Invariante do desafio | Objeto no PostgreSQL | Teste de integração |
|---|---|---|---|
| 1 | No máximo 1 wallet por `playerId + currency` | `uq_wallets__player_currency` | Inserir 2 wallets para mesmo player/moeda → erro `23505` |
| 2 | Saldo da wallet nunca negativo | `ck_wallets__balance_non_negative` | `UPDATE wallets SET balance = -0.01` → erro `23514` |
| 3 | Versão da wallet sempre `>= 1` | `ck_wallets__version_positive` | `INSERT` com `version = 0` → erro `23514` |
| 4 | Dinheiro exato (sem float) e positivo | `NUMERIC(19,2)` + `ck_*__amount_positive` | `INSERT` com `amount = 0` ou `-10` → erro `23514` |
| 5 | Moeda do ledger igual à moeda da wallet | `fk_wallet_ledger_entries__wallet_currency` | `INSERT` no ledger com moeda divergente da wallet → erro `23503` |
| 6 | Lançamento de ledger pertence à mesma wallet/moeda da transação | `fk_wallet_ledger_entries__transaction_wallet_currency` | `INSERT` no ledger apontando para outra wallet/moeda → erro `23503` |
| 7 | No máximo 1 lançamento de ledger por transação | `uq_wallet_ledger_entries__transaction` | 2 lançamentos para mesma `transaction_id` → erro `23505` |
| 8 | Cadeia linear de versões por wallet (anti-lost-update) | `uq_wallet_ledger_entries__wallet_version` | 2 lançamentos com mesma `(wallet_id, wallet_version)` → erro `23505` |
| 9 | Aritmética do lançamento (`balance_before ± amount = balance_after`) | `ck_wallet_ledger_entries__balanced_arithmetic` | `INSERT` com `balance_after` incorreto → erro `23514` |
| 10 | Ledger imutável (append-only) | `trg_wallet_ledger_entries__immutable` | `UPDATE` ou `DELETE` em `wallet_ledger_entries` → erro `55000` |
| 11 | `LOSS` e `REJECTED` não geram ledger | `trg_wallet_ledger_entries__validate_tx` | `INSERT` no ledger para tx `LOSS` ou `REJECTED` → erro `23514` |
| 12 | Idempotência por `(provider_id, idempotency_key)` | `uq_wager_transactions__provider_idempotency_key` | Duplicata de `(provider_id, idempotency_key)` → erro `23505` |
| 13 | Unicidade de `(provider_id, external_transaction_id)` | `uq_wager_transactions__provider_external_tx` | Duplicata de `(provider_id, external_transaction_id)` → erro `23505` |
| 14 | `OPENING` restrito ao uso interno | `ck_wager_transactions__opening_internal_only` | `OPENING` com `provider_id != '__internal__'` → erro `23514` |
| 15 | `REFUND` e `ROLLBACK` exigem `reference_external_transaction_id` | `ck_wager_transactions__reference_required_for_reversal` | `REFUND` sem `reference_external_transaction_id` → erro `23514` |
| 16 | `failure_code` presente se e somente se `REJECTED` ou `FAILED` | `ck_wager_transactions__failure_code_iff_failed_or_rejected` | `REJECTED` sem `failure_code` ou `PROCESSED` com `failure_code` → erro `23514` |
| 17 | Estados terminais nunca mudam | `trg_wager_transactions__terminal_immutable` | `UPDATE` de `PROCESSED`/`REJECTED`/`FAILED` → erro `55000` |
| 18 | Transação `PROCESSED` tem mesmo player/moeda da wallet e referência válida | `trg_wager_transactions__guard` | `PROCESSED` com moeda/player/valor/kind de referência inválido → erro `23514` |
| 19 | No máximo uma reversão efetiva por transação referenciada | `uq_wager_transactions__single_reversal` | `REFUND` e `ROLLBACK` ambos `PROCESSED` na mesma `BET` → erro `23505` |
| 20 | Deduplicação persistente de Inbox por `(consumer_name, message_id)` | `pk_inbox_messages` | Segundo `INSERT` com mesmo `(consumer_name, message_id)` → conflito de PK |

## 6. Modos de falha

| Falha | Comportamento esperado no banco | Teste |
|---|---|---|
| Bug na aplicação tenta gravar saldo negativo | PostgreSQL aborta a transação com violação de `ck_wallets__balance_non_negative` | Teste de constraint #2 |
| Bug na aplicação tenta sobrescrever ou apagar linha do ledger | Trigger `trg_wallet_ledger_entries__immutable` aborta a transação | Teste de constraint #10 |
| Duas instâncias tentam criar wallet para o mesmo `(player_id, currency)` simultaneamente | Uma confirma, a outra recebe `23505` (`uq_wallets__player_currency`) e traduz para `409 Conflict` | Teste de integração de concorrência em `POST /wallets` |
| Duas instâncias tentam inserir a mesma `(provider_id, idempotency_key)` | Uma confirma, a outra trata o conflito lendo o registro existente e comparando `payload_hash` | Teste de concorrência 50× em paralelo |
| Duas reversões concorrentes (`REFUND` + `ROLLBACK`) sobre a mesma `BET` | Lock da wallet + partial unique index `uq_wager_transactions__single_reversal` impedem a segunda reversão | Teste de constraint #19 + teste de concorrência |

## 7. Alternativas consideradas

1. **Tipos `ENUM` nativos do PostgreSQL (`CREATE TYPE ... AS ENUM`) vs `TEXT + CHECK`**: escolhemos `TEXT + CHECK`
   pela facilidade de evolução e reversão em migrations sem lock de catálogo ([ADR-0008](../adr/0008-modelar-enums-no-postgres-com-text-e-check-constraints.md)).
2. **Armazenar centavos como `BIGINT` no banco vs `NUMERIC(19,2)`**: no domínio usamos `bigint` em unidades
   menores para aritmética inteira rápida, mas no banco usamos `NUMERIC(19,2)` por legibilidade em consultas SQL,
   auditoria direta e alinhamento com o formato `"25.00"` ([ADR-0007](../adr/0007-representar-money-com-bigint-no-dominio-e-numeric-no-banco.md)).
3. **FK composta direta em `wager_transactions (wallet_id, player_id, currency)` vs validação no trigger quando
   `status = 'PROCESSED'`**: a FK composta irrestrita em `wager_transactions` impediria persistir como `REJECTED`
   uma tentativa enviada com moeda ou player incorreto. Validar no trigger quando `status = 'PROCESSED'` + na FK
   composta de `wallet_ledger_entries` preserva tanto a auditoria de rejeições quanto a garantia no schema
   ([ADR-0009](../adr/0009-garantir-invariantes-financeiras-no-schema-postgres.md)).

## 8. Observabilidade

- Erros de constraint do PostgreSQL (`23505`, `23503`, `23514`, `55000`) expõem `constraint` nos metadados do
  driver `pg`, permitindo que a camada de infraestrutura diferencie conflito de idempotência esperado de violação
  inesperada de invariante (logada como `ERROR` e contabilizada em métrica).

## 9. Plano de testes

- **Ciclo de reversibilidade**: `up → down → up` em banco limpo verificando que `down` remove 100% das tabelas e
  funções criadas.
- **Suíte `test/integration/schema/schema-constraints.spec.ts`**: 20 testes de integração (um para cada linha da
  tabela da seção 5) executando SQL real contra o PostgreSQL 17 e verificando o nome exato da constraint ou
  trigger acionado.

## 10. Plano de implementação

- [x] Criar ADRs 0007, 0008 e 0009.
- [x] Implementar a migration inicial `Migration0001InitialSchema` em `src/infrastructure/persistence/migrations/`.
- [x] Implementar os `EntitySchema`s e `Record`s do MikroORM correspondentes às 5 tabelas.
- [x] Implementar a suíte `test/integration/schema/schema-constraints.spec.ts` cobrindo todas as 20 garantias.

## 11. Riscos e questões em aberto

- Nenhum ponto bloqueante: todas as regras de negócio das seções 6 e 7 estão mapeadas.

