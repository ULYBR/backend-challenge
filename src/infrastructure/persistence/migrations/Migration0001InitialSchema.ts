import { Migration } from "@mikro-orm/migrations";

export class Migration0001InitialSchema extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE wallets (
        id          UUID            NOT NULL,
        player_id   UUID            NOT NULL,
        currency    CHAR(3)         NOT NULL,
        balance     NUMERIC(19, 2)  NOT NULL,
        version     INTEGER         NOT NULL,
        created_at  TIMESTAMPTZ     NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ     NOT NULL DEFAULT now(),

        CONSTRAINT pk_wallets PRIMARY KEY (id),
        CONSTRAINT uq_wallets__player_currency UNIQUE (player_id, currency),
        CONSTRAINT uq_wallets__id_currency UNIQUE (id, currency),
        CONSTRAINT ck_wallets__currency_iso CHECK (currency ~ '^[A-Z]{3}$'),
        CONSTRAINT ck_wallets__balance_non_negative CHECK (balance >= 0),
        CONSTRAINT ck_wallets__version_positive CHECK (version >= 1)
      );
    `);

    this.addSql(`
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

      CREATE UNIQUE INDEX uq_wager_transactions__single_reversal
        ON wager_transactions (reference_transaction_id)
        WHERE kind IN ('REFUND', 'ROLLBACK') AND status = 'PROCESSED';

      CREATE INDEX ix_wager_transactions__pending_reference_due
        ON wager_transactions (next_reference_attempt_at ASC)
        WHERE status = 'PENDING_REFERENCE';

      CREATE INDEX ix_wager_transactions__wallet_created
        ON wager_transactions (wallet_id, created_at DESC);
    `);

    this.addSql(`
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

      CREATE INDEX ix_wallet_ledger_entries__wallet_cursor
        ON wallet_ledger_entries (wallet_id, created_at ASC, id ASC);
    `);

    this.addSql(`
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
    `);

    this.addSql(`
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

      CREATE INDEX ix_outbox_messages__pending_due
        ON outbox_messages (next_attempt_at ASC, occurred_at ASC)
        WHERE published_at IS NULL;
    `);

    this.addSql(`
      CREATE OR REPLACE FUNCTION fn_wallet_ledger_entries_immutable()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'wallet_ledger_entries is append-only: % is prohibited [trg_wallet_ledger_entries__immutable]', TG_OP
          USING ERRCODE = '55000';
      END;
      $$;

      CREATE TRIGGER trg_wallet_ledger_entries__immutable
        BEFORE UPDATE OR DELETE ON wallet_ledger_entries
        FOR EACH ROW
        EXECUTE FUNCTION fn_wallet_ledger_entries_immutable();

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
          RAISE EXCEPTION 'Ledger entry requires PROCESSED transaction (got %) [trg_wallet_ledger_entries__validate_tx]', v_status
            USING ERRCODE = '23514';
        END IF;

        IF v_kind = 'LOSS' THEN
          RAISE EXCEPTION 'LOSS transaction cannot generate ledger entry [trg_wallet_ledger_entries__validate_tx]'
            USING ERRCODE = '23514';
        END IF;

        RETURN NEW;
      END;
      $$;

      CREATE TRIGGER trg_wallet_ledger_entries__validate_tx
        BEFORE INSERT ON wallet_ledger_entries
        FOR EACH ROW
        EXECUTE FUNCTION fn_wallet_ledger_entries_validate_tx();

      CREATE OR REPLACE FUNCTION fn_wager_transactions_guard()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      AS $$
      DECLARE
        v_wallet_player   UUID;
        v_wallet_currency CHAR(3);
        v_ref             RECORD;
      BEGIN
        IF TG_OP = 'UPDATE' THEN
          IF OLD.status IN ('PROCESSED', 'REJECTED', 'FAILED') THEN
            RAISE EXCEPTION 'Cannot mutate terminal wager_transaction (id=%, status=%) [trg_wager_transactions__terminal_immutable]', OLD.id, OLD.status
              USING ERRCODE = '55000';
          END IF;

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
            RAISE EXCEPTION 'Cannot mutate immutable business columns of wager_transaction (id=%) [trg_wager_transactions__business_columns_immutable]', OLD.id
              USING ERRCODE = '55000';
          END IF;
        END IF;

        IF NEW.status = 'PROCESSED' THEN
          SELECT player_id, currency
            INTO v_wallet_player, v_wallet_currency
            FROM wallets
           WHERE id = NEW.wallet_id;

          IF v_wallet_player <> NEW.player_id OR v_wallet_currency <> NEW.currency THEN
            RAISE EXCEPTION 'PROCESSED transaction must match wallet player_id and currency [trg_wager_transactions__wallet_context_match]'
              USING ERRCODE = '23514';
          END IF;

          IF NEW.kind IN ('REFUND', 'ROLLBACK') THEN
            SELECT id, provider_id, wallet_id, player_id, round_id, kind, amount, currency, status
              INTO v_ref
              FROM wager_transactions
             WHERE id = NEW.reference_transaction_id;

            IF NOT FOUND OR v_ref.status <> 'PROCESSED' THEN
              RAISE EXCEPTION 'Referenced transaction must exist and be PROCESSED [trg_wager_transactions__reference_valid]'
                USING ERRCODE = '23514';
            END IF;

            IF v_ref.provider_id <> NEW.provider_id
               OR v_ref.wallet_id <> NEW.wallet_id
               OR v_ref.player_id <> NEW.player_id
               OR v_ref.round_id <> NEW.round_id
               OR v_ref.currency <> NEW.currency
               OR v_ref.amount <> NEW.amount
            THEN
              RAISE EXCEPTION 'Referenced transaction context or amount mismatch [trg_wager_transactions__reference_context_match]'
                USING ERRCODE = '23514';
            END IF;

            IF (NEW.kind = 'REFUND' AND v_ref.kind <> 'BET')
               OR (NEW.kind = 'ROLLBACK' AND v_ref.kind NOT IN ('BET', 'WIN', 'REFUND'))
            THEN
              RAISE EXCEPTION 'Invalid referenced transaction kind (%) for % [trg_wager_transactions__reference_kind_valid]', v_ref.kind, NEW.kind
                USING ERRCODE = '23514';
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
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`
      DROP TRIGGER IF EXISTS trg_wager_transactions__guard ON wager_transactions;
      DROP FUNCTION IF EXISTS fn_wager_transactions_guard();

      DROP TRIGGER IF EXISTS trg_wallet_ledger_entries__validate_tx ON wallet_ledger_entries;
      DROP FUNCTION IF EXISTS fn_wallet_ledger_entries_validate_tx();

      DROP TRIGGER IF EXISTS trg_wallet_ledger_entries__immutable ON wallet_ledger_entries;
      DROP FUNCTION IF EXISTS fn_wallet_ledger_entries_immutable();

      DROP TABLE IF EXISTS outbox_messages;
      DROP TABLE IF EXISTS inbox_messages;
      DROP TABLE IF EXISTS wallet_ledger_entries;
      DROP TABLE IF EXISTS wager_transactions;
      DROP TABLE IF EXISTS wallets;
    `);
  }
}
