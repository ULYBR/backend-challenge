import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { parseEnv } from "@infrastructure/config/env";
import { buildMikroOrmOptions } from "@infrastructure/persistence/mikro-orm.config";
import { EntityManager, MikroORM } from "@mikro-orm/postgresql";
import { assertAllWalletsMatchLedger } from "@test/helpers/ledger-invariant.helper";

const VALID_HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);

describe("Phase 2 — PostgreSQL Schema Invariants & Constraints (RFC-0002 / ADR-0007..0009)", () => {
  let orm: MikroORM;
  let em: EntityManager;

  beforeAll(async () => {
    const env = parseEnv({
      ...process.env,
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
    });
    orm = await MikroORM.init(buildMikroOrmOptions(env));
    em = orm.em;

    const migrator = orm.getMigrator();
    await migrator.up();
  });

  beforeEach(async () => {
    await em.getConnection().execute(`
      TRUNCATE TABLE
        outbox_messages,
        inbox_messages,
        wallet_ledger_entries,
        wager_transactions,
        wallets
      CASCADE;
    `);
  });

  afterAll(async () => {
    if (orm !== undefined) {
      await assertAllWalletsMatchLedger(em);
      await orm.close(true);
    }
  });

  async function seedOpenedWallet(overrides?: {
    walletId?: string;
    playerId?: string;
    currency?: string;
    initialBalance?: string;
  }) {
    const walletId = overrides?.walletId ?? Bun.randomUUIDv7();
    const playerId = overrides?.playerId ?? Bun.randomUUIDv7();
    const currency = overrides?.currency ?? "BRL";
    const initialBalance = overrides?.initialBalance ?? "100.00";
    const openingTxId = Bun.randomUUIDv7();
    const openingLedgerId = Bun.randomUUIDv7();

    await em.getConnection().execute(`
      INSERT INTO wallets (id, player_id, currency, balance, version)
      VALUES ('${walletId}', '${playerId}', '${currency}', ${initialBalance}, 1);

      INSERT INTO wager_transactions (
        id, provider_id, external_transaction_id, idempotency_key, payload_hash,
        wallet_id, player_id, round_id, game_id, kind, amount, currency,
        status, recorded_balance, processed_at
      ) VALUES (
        '${openingTxId}', '__internal__', 'opening:${walletId}', 'opening:${walletId}', '${VALID_HASH}',
        '${walletId}', '${playerId}', '__opening__', '__opening__', 'OPENING', ${initialBalance}, '${currency}',
        'PROCESSED', ${initialBalance}, now()
      );

      INSERT INTO wallet_ledger_entries (
        id, wallet_id, transaction_id, wallet_version, direction, amount, currency,
        balance_before, balance_after
      ) VALUES (
        '${openingLedgerId}', '${walletId}', '${openingTxId}', 1, 'CREDIT', ${initialBalance}, '${currency}',
        0.00, ${initialBalance}
      );
    `);

    return { walletId, playerId, currency, openingTxId };
  }

  it("0. proves migration reversibility (up -> down -> up)", async () => {
    const migrator = orm.getMigrator();
    await migrator.down();

    const tablesAfterDown = await em.getConnection().execute<Array<{ tablename: string }>>(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename IN ('wallets', 'wager_transactions', 'wallet_ledger_entries', 'inbox_messages', 'outbox_messages');
    `);
    expect(tablesAfterDown.length).toBe(0);

    await migrator.up();
    const tablesAfterUp = await em.getConnection().execute<Array<{ tablename: string }>>(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename IN ('wallets', 'wager_transactions', 'wallet_ledger_entries', 'inbox_messages', 'outbox_messages');
    `);
    expect(tablesAfterUp.length).toBe(5);
  });

  it("1. enforces at most 1 wallet per playerId + currency (uq_wallets__player_currency)", async () => {
    const { playerId } = await seedOpenedWallet({ currency: "BRL" });
    const duplicateWalletId = Bun.randomUUIDv7();

    await expect(
      em.getConnection().execute(`
        INSERT INTO wallets (id, player_id, currency, balance, version)
        VALUES ('${duplicateWalletId}', '${playerId}', 'BRL', 0.00, 1);
      `),
    ).rejects.toThrow(/uq_wallets__player_currency/);
  });

  it("2. forbids negative wallet balance (ck_wallets__balance_non_negative)", async () => {
    const { walletId } = await seedOpenedWallet();

    await expect(
      em.getConnection().execute(`
        UPDATE wallets SET balance = -0.01 WHERE id = '${walletId}';
      `),
    ).rejects.toThrow(/ck_wallets__balance_non_negative/);
  });

  it("3. enforces wallet version >= 1 (ck_wallets__version_positive)", async () => {
    const walletId = Bun.randomUUIDv7();
    const playerId = Bun.randomUUIDv7();

    await expect(
      em.getConnection().execute(`
        INSERT INTO wallets (id, player_id, currency, balance, version)
        VALUES ('${walletId}', '${playerId}', 'BRL', 0.00, 0);
      `),
    ).rejects.toThrow(/ck_wallets__version_positive/);
  });

  it("4. enforces strictly positive monetary amounts and ISO currency (ck_*__amount_positive / currency_iso)", async () => {
    const { walletId, playerId } = await seedOpenedWallet();
    const txId = Bun.randomUUIDv7();

    await expect(
      em.getConnection().execute(`
        INSERT INTO wager_transactions (
          id, provider_id, external_transaction_id, idempotency_key, payload_hash,
          wallet_id, player_id, round_id, game_id, kind, amount, currency, status
        ) VALUES (
          '${txId}', 'prov-1', 'ext-zero', 'prov-1:ext-zero', '${VALID_HASH}',
          '${walletId}', '${playerId}', 'r-1', 'g-1', 'BET', 0.00, 'BRL', 'PENDING'
        );
      `),
    ).rejects.toThrow(/ck_wager_transactions__amount_positive/);
  });

  it("5 & 6. enforces composite FK between ledger, wallet and transaction currency (fk_wallet_ledger_entries__*)", async () => {
    const { walletId, playerId } = await seedOpenedWallet({ currency: "BRL" });
    const otherWallet = await seedOpenedWallet({ currency: "BRL" });
    const betTxId = Bun.randomUUIDv7();

    await em.getConnection().execute(`
      INSERT INTO wager_transactions (
        id, provider_id, external_transaction_id, idempotency_key, payload_hash,
        wallet_id, player_id, round_id, game_id, kind, amount, currency, status, processed_at
      ) VALUES (
        '${betTxId}', 'prov-1', 'ext-1', 'prov-1:ext-1', '${VALID_HASH}',
        '${walletId}', '${playerId}', 'r-1', 'g-1', 'BET', 10.00, 'BRL', 'PROCESSED', now()
      );
    `);

    await expect(
      em.getConnection().execute(`
        INSERT INTO wallet_ledger_entries (
          id, wallet_id, transaction_id, wallet_version, direction, amount, currency,
          balance_before, balance_after
        ) VALUES (
          '${Bun.randomUUIDv7()}', '${otherWallet.walletId}', '${betTxId}', 2, 'DEBIT', 10.00, 'BRL',
          100.00, 90.00
        );
      `),
    ).rejects.toThrow(/fk_wallet_ledger_entries__transaction_wallet_currency/);
  });

  it("7 & 8. enforces at most 1 ledger entry per transaction and unique (wallet_id, wallet_version)", async () => {
    const { walletId, playerId } = await seedOpenedWallet();
    const tx1 = Bun.randomUUIDv7();
    const tx2 = Bun.randomUUIDv7();

    await em.getConnection().execute(`
      UPDATE wallets SET balance = 80.00, version = 2 WHERE id = '${walletId}';

      INSERT INTO wager_transactions (
        id, provider_id, external_transaction_id, idempotency_key, payload_hash,
        wallet_id, player_id, round_id, game_id, kind, amount, currency, status, processed_at
      ) VALUES
      (
        '${tx1}', 'prov-1', 'ext-1', 'prov-1:ext-1', '${VALID_HASH}',
        '${walletId}', '${playerId}', 'r-1', 'g-1', 'BET', 20.00, 'BRL', 'PROCESSED', now()
      ),
      (
        '${tx2}', 'prov-1', 'ext-2', 'prov-1:ext-2', '${VALID_HASH}',
        '${walletId}', '${playerId}', 'r-1', 'g-1', 'BET', 20.00, 'BRL', 'PROCESSED', now()
      );

      INSERT INTO wallet_ledger_entries (
        id, wallet_id, transaction_id, wallet_version, direction, amount, currency,
        balance_before, balance_after
      ) VALUES (
        '${Bun.randomUUIDv7()}', '${walletId}', '${tx1}', 2, 'DEBIT', 20.00, 'BRL',
        100.00, 80.00
      );
    `);

    await expect(
      em.getConnection().execute(`
        INSERT INTO wallet_ledger_entries (
          id, wallet_id, transaction_id, wallet_version, direction, amount, currency,
          balance_before, balance_after
        ) VALUES (
          '${Bun.randomUUIDv7()}', '${walletId}', '${tx1}', 3, 'DEBIT', 20.00, 'BRL',
          80.00, 60.00
        );
      `),
    ).rejects.toThrow(/uq_wallet_ledger_entries__transaction/);

    await expect(
      em.getConnection().execute(`
        INSERT INTO wallet_ledger_entries (
          id, wallet_id, transaction_id, wallet_version, direction, amount, currency,
          balance_before, balance_after
        ) VALUES (
          '${Bun.randomUUIDv7()}', '${walletId}', '${tx2}', 2, 'DEBIT', 20.00, 'BRL',
          100.00, 80.00
        );
      `),
    ).rejects.toThrow(/uq_wallet_ledger_entries__wallet_version/);
  });

  it("9. enforces balanced arithmetic on ledger entries (ck_wallet_ledger_entries__balanced_arithmetic)", async () => {
    const { walletId, playerId } = await seedOpenedWallet();
    const txId = Bun.randomUUIDv7();

    await em.getConnection().execute(`
      INSERT INTO wager_transactions (
        id, provider_id, external_transaction_id, idempotency_key, payload_hash,
        wallet_id, player_id, round_id, game_id, kind, amount, currency, status, processed_at
      ) VALUES (
        '${txId}', 'prov-1', 'ext-arith', 'prov-1:ext-arith', '${VALID_HASH}',
        '${walletId}', '${playerId}', 'r-1', 'g-1', 'BET', 25.00, 'BRL', 'PROCESSED', now()
      );
    `);

    await expect(
      em.getConnection().execute(`
        INSERT INTO wallet_ledger_entries (
          id, wallet_id, transaction_id, wallet_version, direction, amount, currency,
          balance_before, balance_after
        ) VALUES (
          '${Bun.randomUUIDv7()}', '${walletId}', '${txId}', 2, 'DEBIT', 25.00, 'BRL',
          100.00, 80.00
        );
      `),
    ).rejects.toThrow(/ck_wallet_ledger_entries__balanced_arithmetic/);
  });

  it("10. blocks UPDATE and DELETE on wallet_ledger_entries (trg_wallet_ledger_entries__immutable)", async () => {
    const { walletId } = await seedOpenedWallet();

    await expect(
      em.getConnection().execute(`
        UPDATE wallet_ledger_entries SET amount = 999.00 WHERE wallet_id = '${walletId}';
      `),
    ).rejects.toThrow(/trg_wallet_ledger_entries__immutable/);

    await expect(
      em.getConnection().execute(`
        DELETE FROM wallet_ledger_entries WHERE wallet_id = '${walletId}';
      `),
    ).rejects.toThrow(/trg_wallet_ledger_entries__immutable/);
  });

  it("11. blocks ledger entries for LOSS or non-PROCESSED transactions (trg_wallet_ledger_entries__validate_tx)", async () => {
    const { walletId, playerId } = await seedOpenedWallet();
    const lossTxId = Bun.randomUUIDv7();
    const rejectedTxId = Bun.randomUUIDv7();

    await em.getConnection().execute(`
      INSERT INTO wager_transactions (
        id, provider_id, external_transaction_id, idempotency_key, payload_hash,
        wallet_id, player_id, round_id, game_id, kind, amount, currency, status, processed_at
      ) VALUES (
        '${lossTxId}', 'prov-1', 'ext-loss', 'prov-1:ext-loss', '${VALID_HASH}',
        '${walletId}', '${playerId}', 'r-1', 'g-1', 'LOSS', 10.00, 'BRL', 'PROCESSED', now()
      );

      INSERT INTO wager_transactions (
        id, provider_id, external_transaction_id, idempotency_key, payload_hash,
        wallet_id, player_id, round_id, game_id, kind, amount, currency, status, failure_code, processed_at
      ) VALUES (
        '${rejectedTxId}', 'prov-1', 'ext-rej', 'prov-1:ext-rej', '${VALID_HASH}',
        '${walletId}', '${playerId}', 'r-1', 'g-1', 'BET', 500.00, 'BRL', 'REJECTED', 'INSUFFICIENT_FUNDS', now()
      );
    `);

    await expect(
      em.getConnection().execute(`
        INSERT INTO wallet_ledger_entries (
          id, wallet_id, transaction_id, wallet_version, direction, amount, currency,
          balance_before, balance_after
        ) VALUES (
          '${Bun.randomUUIDv7()}', '${walletId}', '${lossTxId}', 2, 'DEBIT', 10.00, 'BRL',
          100.00, 90.00
        );
      `),
    ).rejects.toThrow(/trg_wallet_ledger_entries__validate_tx/);

    await expect(
      em.getConnection().execute(`
        INSERT INTO wallet_ledger_entries (
          id, wallet_id, transaction_id, wallet_version, direction, amount, currency,
          balance_before, balance_after
        ) VALUES (
          '${Bun.randomUUIDv7()}', '${walletId}', '${rejectedTxId}', 2, 'DEBIT', 500.00, 'BRL',
          100.00, 0.00
        );
      `),
    ).rejects.toThrow(/trg_wallet_ledger_entries__validate_tx/);
  });

  it("12 & 13. enforces unique (provider_id, idempotency_key) and (provider_id, external_transaction_id)", async () => {
    const { walletId, playerId } = await seedOpenedWallet();

    await em.getConnection().execute(`
      INSERT INTO wager_transactions (
        id, provider_id, external_transaction_id, idempotency_key, payload_hash,
        wallet_id, player_id, round_id, game_id, kind, amount, currency, status
      ) VALUES (
        '${Bun.randomUUIDv7()}', 'prov-a', 'tx-100', 'prov-a:idem-100', '${VALID_HASH}',
        '${walletId}', '${playerId}', 'r-1', 'g-1', 'BET', 10.00, 'BRL', 'PENDING'
      );
    `);

    await expect(
      em.getConnection().execute(`
        INSERT INTO wager_transactions (
          id, provider_id, external_transaction_id, idempotency_key, payload_hash,
          wallet_id, player_id, round_id, game_id, kind, amount, currency, status
        ) VALUES (
          '${Bun.randomUUIDv7()}', 'prov-a', 'tx-101', 'prov-a:idem-100', '${OTHER_HASH}',
          '${walletId}', '${playerId}', 'r-1', 'g-1', 'BET', 10.00, 'BRL', 'PENDING'
        );
      `),
    ).rejects.toThrow(/uq_wager_transactions__provider_idempotency_key/);

    await expect(
      em.getConnection().execute(`
        INSERT INTO wager_transactions (
          id, provider_id, external_transaction_id, idempotency_key, payload_hash,
          wallet_id, player_id, round_id, game_id, kind, amount, currency, status
        ) VALUES (
          '${Bun.randomUUIDv7()}', 'prov-a', 'tx-100', 'prov-a:idem-999', '${OTHER_HASH}',
          '${walletId}', '${playerId}', 'r-1', 'g-1', 'BET', 10.00, 'BRL', 'PENDING'
        );
      `),
    ).rejects.toThrow(/uq_wager_transactions__provider_external_tx/);
  });

  it("14, 15 & 16. enforces OPENING internal-only, reference required for REFUND/ROLLBACK, and failure_code iff REJECTED/FAILED", async () => {
    const { walletId, playerId } = await seedOpenedWallet();

    await expect(
      em.getConnection().execute(`
        INSERT INTO wager_transactions (
          id, provider_id, external_transaction_id, idempotency_key, payload_hash,
          wallet_id, player_id, round_id, game_id, kind, amount, currency, status
        ) VALUES (
          '${Bun.randomUUIDv7()}', 'prov-a', 'tx-open', 'prov-a:tx-open', '${VALID_HASH}',
          '${walletId}', '${playerId}', 'r-1', 'g-1', 'OPENING', 10.00, 'BRL', 'PENDING'
        );
      `),
    ).rejects.toThrow(/ck_wager_transactions__opening_internal_only/);

    await expect(
      em.getConnection().execute(`
        INSERT INTO wager_transactions (
          id, provider_id, external_transaction_id, idempotency_key, payload_hash,
          wallet_id, player_id, round_id, game_id, kind, amount, currency, status
        ) VALUES (
          '${Bun.randomUUIDv7()}', 'prov-a', 'tx-ref', 'prov-a:tx-ref', '${VALID_HASH}',
          '${walletId}', '${playerId}', 'r-1', 'g-1', 'REFUND', 10.00, 'BRL', 'PENDING'
        );
      `),
    ).rejects.toThrow(/ck_wager_transactions__reference_required_for_reversal/);

    await expect(
      em.getConnection().execute(`
        INSERT INTO wager_transactions (
          id, provider_id, external_transaction_id, idempotency_key, payload_hash,
          wallet_id, player_id, round_id, game_id, kind, amount, currency, status, processed_at
        ) VALUES (
          '${Bun.randomUUIDv7()}', 'prov-a', 'tx-rej-nocode', 'prov-a:tx-rej-nocode', '${VALID_HASH}',
          '${walletId}', '${playerId}', 'r-1', 'g-1', 'BET', 10.00, 'BRL', 'REJECTED', now()
        );
      `),
    ).rejects.toThrow(/ck_wager_transactions__failure_code_iff_failed_or_rejected/);
  });

  it("17. blocks any state transition or mutation once wager_transaction is terminal (trg_wager_transactions__terminal_immutable)", async () => {
    const { walletId, playerId } = await seedOpenedWallet();
    const txId = Bun.randomUUIDv7();

    await em.getConnection().execute(`
      INSERT INTO wager_transactions (
        id, provider_id, external_transaction_id, idempotency_key, payload_hash,
        wallet_id, player_id, round_id, game_id, kind, amount, currency, status, failure_code, processed_at
      ) VALUES (
        '${txId}', 'prov-a', 'tx-term', 'prov-a:tx-term', '${VALID_HASH}',
        '${walletId}', '${playerId}', 'r-1', 'g-1', 'BET', 500.00, 'BRL', 'REJECTED', 'INSUFFICIENT_FUNDS', now()
      );
    `);

    await expect(
      em.getConnection().execute(`
        UPDATE wager_transactions SET status = 'PROCESSED', failure_code = NULL WHERE id = '${txId}';
      `),
    ).rejects.toThrow(/trg_wager_transactions__terminal_immutable/);
  });

  it("18 & 19. allows persisting REJECTED currency mismatch for audit, blocks PROCESSED mismatch, and enforces single reversal per reference", async () => {
    const { walletId, playerId } = await seedOpenedWallet({ currency: "BRL" });
    const betTxId = Bun.randomUUIDv7();

    await em.getConnection().execute(`
      INSERT INTO wager_transactions (
        id, provider_id, external_transaction_id, idempotency_key, payload_hash,
        wallet_id, player_id, round_id, game_id, kind, amount, currency, status, failure_code, recorded_balance, processed_at
      ) VALUES (
        '${Bun.randomUUIDv7()}', 'prov-a', 'tx-usd-rej', 'prov-a:tx-usd-rej', '${VALID_HASH}',
        '${walletId}', '${playerId}', 'r-1', 'g-1', 'BET', 10.00, 'USD', 'REJECTED', 'CURRENCY_MISMATCH', 100.00, now()
      );
    `);

    await expect(
      em.getConnection().execute(`
        INSERT INTO wager_transactions (
          id, provider_id, external_transaction_id, idempotency_key, payload_hash,
          wallet_id, player_id, round_id, game_id, kind, amount, currency, status, processed_at
        ) VALUES (
          '${Bun.randomUUIDv7()}', 'prov-a', 'tx-usd-proc', 'prov-a:tx-usd-proc', '${VALID_HASH}',
          '${walletId}', '${playerId}', 'r-1', 'g-1', 'BET', 10.00, 'USD', 'PROCESSED', now()
        );
      `),
    ).rejects.toThrow(/trg_wager_transactions__wallet_context_match/);

    await em.getConnection().execute(`
      INSERT INTO wager_transactions (
        id, provider_id, external_transaction_id, idempotency_key, payload_hash,
        wallet_id, player_id, round_id, game_id, kind, amount, currency, status, processed_at
      ) VALUES (
        '${betTxId}', 'prov-a', 'bet-1', 'prov-a:bet-1', '${VALID_HASH}',
        '${walletId}', '${playerId}', 'r-1', 'g-1', 'BET', 20.00, 'BRL', 'PROCESSED', now()
      );

      INSERT INTO wager_transactions (
        id, provider_id, external_transaction_id, idempotency_key, payload_hash,
        wallet_id, player_id, round_id, game_id, kind, amount, currency,
        reference_external_transaction_id, reference_transaction_id, status, processed_at
      ) VALUES (
        '${Bun.randomUUIDv7()}', 'prov-a', 'refund-1', 'prov-a:refund-1', '${VALID_HASH}',
        '${walletId}', '${playerId}', 'r-1', 'g-1', 'REFUND', 20.00, 'BRL',
        'bet-1', '${betTxId}', 'PROCESSED', now()
      );
    `);

    await expect(
      em.getConnection().execute(`
        INSERT INTO wager_transactions (
          id, provider_id, external_transaction_id, idempotency_key, payload_hash,
          wallet_id, player_id, round_id, game_id, kind, amount, currency,
          reference_external_transaction_id, reference_transaction_id, status, processed_at
        ) VALUES (
          '${Bun.randomUUIDv7()}', 'prov-a', 'rollback-after-refund', 'prov-a:rollback-after-refund', '${OTHER_HASH}',
          '${walletId}', '${playerId}', 'r-1', 'g-1', 'ROLLBACK', 20.00, 'BRL',
          'bet-1', '${betTxId}', 'PROCESSED', now()
        );
      `),
    ).rejects.toThrow(/uq_wager_transactions__single_reversal/);
  });

  it("20. enforces persistent inbox deduplication by (consumer_name, message_id) (pk_inbox_messages)", async () => {
    await em.getConnection().execute(`
      INSERT INTO inbox_messages (consumer_name, message_id, payload_hash)
      VALUES ('wager-consumer', 'msg-001', '${VALID_HASH}');
    `);

    await expect(
      em.getConnection().execute(`
        INSERT INTO inbox_messages (consumer_name, message_id, payload_hash)
        VALUES ('wager-consumer', 'msg-001', '${VALID_HASH}');
      `),
    ).rejects.toThrow(/pk_inbox_messages/);
  });
});
