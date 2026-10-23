import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { TOKENS } from "@application/ports/tokens";
import {
  GetWalletUseCase,
  OpenWalletUseCase,
  ProcessWagerTransactionUseCase,
  ReconcileWalletUseCase,
} from "@application/use-cases";
import { FailureCode } from "@domain/shared/failure-code";
import { WagerTransactionKind, WagerTransactionStatus } from "@domain/wagering/wager-transaction";
import { parseEnv } from "@infrastructure/config/env";
import { EntityManager, MikroORM } from "@mikro-orm/postgresql";
import { INestApplicationContext } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "@src/app.module";
import { assertAllWalletsMatchLedger } from "@test/helpers/assert-wallet-ledger-invariant";

describe("Phase 4 Concurrency — Hot Wallet Pessimistic Lock & 50x Idempotency Race (Section 8.2 & 9)", () => {
  let appContext: INestApplicationContext;
  let orm: MikroORM;
  let em: EntityManager;
  let openWalletUseCase: OpenWalletUseCase;
  let processWagerUseCase: ProcessWagerTransactionUseCase;
  let reconcileWalletUseCase: ReconcileWalletUseCase;
  let getWalletUseCase: GetWalletUseCase;

  beforeAll(async () => {
    const env = parseEnv({
      ...process.env,
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      APP_ROLE: "api",
      DB_POOL_MAX: "30",
    });

    appContext = await NestFactory.createApplicationContext(AppModule.register(env), {
      logger: false,
    });

    orm = appContext.get<MikroORM>(TOKENS.MIKRO_ORM);
    em = appContext.get<EntityManager>(TOKENS.ENTITY_MANAGER);
    openWalletUseCase = appContext.get(OpenWalletUseCase);
    processWagerUseCase = appContext.get(ProcessWagerTransactionUseCase);
    reconcileWalletUseCase = appContext.get(ReconcileWalletUseCase);
    getWalletUseCase = appContext.get(GetWalletUseCase);

    await orm.getMigrator().up();
  });

  beforeEach(async () => {
    await em.execute(
      "TRUNCATE TABLE outbox_messages, inbox_messages, wallet_ledger_entries, wager_transactions, wallets CASCADE",
    );
  });

  afterAll(async () => {
    await appContext.close();
  });

  it("Mandatory Scenario 8.2.1: Wallet with 100.00 balance receiving 2 parallel BETs of 80.00 processes 1 and rejects 1 with INSUFFICIENT_FUNDS (final balance 20.00)", async () => {
    const playerId = randomUUID();
    const wallet = await openWalletUseCase.execute({
      playerId,
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    const [resA, resB] = await Promise.all([
      processWagerUseCase.execute({
        providerId: "prov-a",
        externalTransactionId: "ext-parallel-80-a",
        walletId: wallet.id,
        playerId,
        roundId: "round-race-1",
        gameId: "slot-1",
        kind: WagerTransactionKind.Bet,
        money: { amount: "80.00", currency: "BRL" },
      }),
      processWagerUseCase.execute({
        providerId: "prov-a",
        externalTransactionId: "ext-parallel-80-b",
        walletId: wallet.id,
        playerId,
        roundId: "round-race-1",
        gameId: "slot-1",
        kind: WagerTransactionKind.Bet,
        money: { amount: "80.00", currency: "BRL" },
      }),
    ]);

    const statuses = [resA.transaction.status, resB.transaction.status].sort();
    expect(statuses).toEqual([WagerTransactionStatus.Processed, WagerTransactionStatus.Rejected]);

    const rejected = resA.transaction.status === WagerTransactionStatus.Rejected ? resA : resB;
    expect(rejected.transaction.failureCode).toBe(FailureCode.InsufficientFunds);

    const finalWallet = await getWalletUseCase.execute({ walletId: wallet.id });
    expect(finalWallet.balance.amount).toBe("20.00");
    expect(finalWallet.version).toBe(2);

    const ledgerCount = await em.execute<Array<{ readonly count: string }>>(
      "SELECT COUNT(*)::text AS count FROM wallet_ledger_entries WHERE wallet_id = ?",
      [wallet.id],
    );
    expect(Number(ledgerCount[0]?.count)).toBe(2);

    await assertAllWalletsMatchLedger(em, reconcileWalletUseCase);
  });

  it("Mandatory Scenario 8.2.2: 50 parallel identical BET requests with same (providerId, externalTransactionId) debit wallet ONCE and create 1 ledger entry", async () => {
    const playerId = randomUUID();
    const wallet = await openWalletUseCase.execute({
      playerId,
      initialBalance: { amount: "500.00", currency: "BRL" },
    });

    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        processWagerUseCase.execute({
          providerId: "prov-a",
          externalTransactionId: "ext-50x-same",
          walletId: wallet.id,
          playerId,
          roundId: "round-50x",
          gameId: "slot-1",
          kind: WagerTransactionKind.Bet,
          money: { amount: "25.00", currency: "BRL" },
        }),
      ),
    );

    const uniqueTxIds = new Set(results.map((r) => r.transaction.id));
    expect(uniqueTxIds.size).toBe(1);

    const nonReplayCount = results.filter((r) => !r.idempotentReplay).length;
    const replayCount = results.filter((r) => r.idempotentReplay).length;
    expect(nonReplayCount).toBe(1);
    expect(replayCount).toBe(49);

    const finalWallet = await getWalletUseCase.execute({ walletId: wallet.id });
    expect(finalWallet.balance.amount).toBe("475.00");
    expect(finalWallet.version).toBe(2);

    const debitLedgerRows = await em.execute<Array<{ readonly count: string }>>(
      `SELECT COUNT(*)::text AS count FROM wallet_ledger_entries WHERE wallet_id = ? AND direction = 'DEBIT'`,
      [wallet.id],
    );
    expect(Number(debitLedgerRows[0]?.count)).toBe(1);

    await assertAllWalletsMatchLedger(em, reconcileWalletUseCase);
  });

  it("Single Reversal Race: simultaneous REFUND and ROLLBACK on the same BET process 1 and reject 1 with REFERENCE_ALREADY_REVERSED", async () => {
    const playerId = randomUUID();
    const wallet = await openWalletUseCase.execute({
      playerId,
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    await processWagerUseCase.execute({
      providerId: "prov-a",
      externalTransactionId: "ext-bet-target",
      walletId: wallet.id,
      playerId,
      roundId: "round-rev-race",
      gameId: "slot-1",
      kind: WagerTransactionKind.Bet,
      money: { amount: "40.00", currency: "BRL" },
    });

    const [refundRes, rollbackRes] = await Promise.all([
      processWagerUseCase.execute({
        providerId: "prov-a",
        externalTransactionId: "ext-refund-race",
        walletId: wallet.id,
        playerId,
        roundId: "round-rev-race",
        gameId: "slot-1",
        kind: WagerTransactionKind.Refund,
        money: { amount: "40.00", currency: "BRL" },
        referenceExternalTransactionId: "ext-bet-target",
      }),
      processWagerUseCase.execute({
        providerId: "prov-a",
        externalTransactionId: "ext-rollback-race",
        walletId: wallet.id,
        playerId,
        roundId: "round-rev-race",
        gameId: "slot-1",
        kind: WagerTransactionKind.Rollback,
        money: { amount: "40.00", currency: "BRL" },
        referenceExternalTransactionId: "ext-bet-target",
      }),
    ]);

    const statuses = [refundRes.transaction.status, rollbackRes.transaction.status].sort();
    expect(statuses).toEqual([WagerTransactionStatus.Processed, WagerTransactionStatus.Rejected]);

    const rejected =
      refundRes.transaction.status === WagerTransactionStatus.Rejected ? refundRes : rollbackRes;
    expect(rejected.transaction.failureCode).toBe(FailureCode.ReferenceAlreadyReversed);

    const finalWallet = await getWalletUseCase.execute({ walletId: wallet.id });
    expect(finalWallet.balance.amount).toBe("100.00");
    expect(finalWallet.version).toBe(3);

    await assertAllWalletsMatchLedger(em, reconcileWalletUseCase);
  });
});
