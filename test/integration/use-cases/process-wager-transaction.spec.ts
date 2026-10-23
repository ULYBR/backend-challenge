import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { TOKENS } from "@application/ports/tokens";
import {
  GetWagerTransactionUseCase,
  GetWalletUseCase,
  ListWalletLedgerUseCase,
  OpenWalletUseCase,
  ProcessWagerTransactionUseCase,
  ReconcileWalletUseCase,
} from "@application/use-cases";
import {
  IdempotencyConflictError,
  InvalidPaginationCursorError,
  WalletAlreadyExistsError,
} from "@domain/shared/domain-errors";
import { FailureCode } from "@domain/shared/failure-code";
import { WagerTransactionKind, WagerTransactionStatus } from "@domain/wagering/wager-transaction";
import { parseEnv } from "@infrastructure/config/env";
import { EntityManager, MikroORM } from "@mikro-orm/postgresql";
import { INestApplicationContext } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "@src/app.module";
import { assertAllWalletsMatchLedger } from "@test/helpers/assert-wallet-ledger-invariant";

describe("Phase 4 Integration — Processing Pipeline, Ledger, Outbox & Idempotency", () => {
  let appContext: INestApplicationContext;
  let orm: MikroORM;
  let em: EntityManager;
  let openWalletUseCase: OpenWalletUseCase;
  let processWagerUseCase: ProcessWagerTransactionUseCase;
  let reconcileWalletUseCase: ReconcileWalletUseCase;
  let getWalletUseCase: GetWalletUseCase;
  let listLedgerUseCase: ListWalletLedgerUseCase;
  let getTxUseCase: GetWagerTransactionUseCase;

  beforeAll(async () => {
    const env = parseEnv({
      ...process.env,
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      APP_ROLE: "api",
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
    listLedgerUseCase = appContext.get(ListWalletLedgerUseCase);
    getTxUseCase = appContext.get(GetWagerTransactionUseCase);

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

  it("opens a wallet with positive initialBalance, creating OPENING transaction, version 1 ledger entry, and outbox event", async () => {
    const playerId = randomUUID();
    const wallet = await openWalletUseCase.execute({
      playerId,
      initialBalance: { amount: "1000.00", currency: "BRL" },
    });

    expect(wallet.playerId).toBe(playerId);
    expect(wallet.balance).toEqual({ amount: "1000.00", currency: "BRL" });
    expect(wallet.version).toBe(1);

    await expect(
      openWalletUseCase.execute({
        playerId,
        initialBalance: { amount: "50.00", currency: "BRL" },
      }),
    ).rejects.toBeInstanceOf(WalletAlreadyExistsError);

    const ledgerPage = await listLedgerUseCase.execute({ walletId: wallet.id });
    expect(ledgerPage.items).toHaveLength(1);
    expect(ledgerPage.items[0]?.walletVersion).toBe(1);
    expect(ledgerPage.items[0]?.balanceBefore.amount).toBe("0.00");
    expect(ledgerPage.items[0]?.balanceAfter.amount).toBe("1000.00");

    await assertAllWalletsMatchLedger(em, reconcileWalletUseCase);
  });

  it("executes full wager lifecycle (BET, WIN, LOSS, REFUND, ROLLBACK) and maintains ledger & outbox invariants", async () => {
    const playerId = randomUUID();
    const wallet = await openWalletUseCase.execute({
      playerId,
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    const bet1 = await processWagerUseCase.execute({
      providerId: "prov-a",
      externalTransactionId: "ext-bet-1",
      walletId: wallet.id,
      playerId,
      roundId: "round-1",
      gameId: "slot-1",
      kind: WagerTransactionKind.Bet,
      money: { amount: "25.00", currency: "BRL" },
    });
    expect(bet1.transaction.status).toBe(WagerTransactionStatus.Processed);
    expect(bet1.balance?.amount).toBe("75.00");
    expect(bet1.idempotentReplay).toBe(false);

    const win1 = await processWagerUseCase.execute({
      providerId: "prov-a",
      externalTransactionId: "ext-win-1",
      walletId: wallet.id,
      playerId,
      roundId: "round-1",
      gameId: "slot-1",
      kind: WagerTransactionKind.Win,
      money: { amount: "50.00", currency: "BRL" },
      referenceExternalTransactionId: "ext-bet-1",
    });
    expect(win1.transaction.status).toBe(WagerTransactionStatus.Processed);
    expect(win1.balance?.amount).toBe("125.00");
    expect(win1.transaction.referenceTransactionId).toBe(bet1.transaction.id);

    const loss1 = await processWagerUseCase.execute({
      providerId: "prov-a",
      externalTransactionId: "ext-loss-1",
      walletId: wallet.id,
      playerId,
      roundId: "round-1",
      gameId: "slot-1",
      kind: WagerTransactionKind.Loss,
      money: { amount: "25.00", currency: "BRL" },
      referenceExternalTransactionId: "ext-bet-1",
    });
    expect(loss1.transaction.status).toBe(WagerTransactionStatus.Processed);
    expect(loss1.balance?.amount).toBe("125.00");

    const refund1 = await processWagerUseCase.execute({
      providerId: "prov-a",
      externalTransactionId: "ext-refund-1",
      walletId: wallet.id,
      playerId,
      roundId: "round-1",
      gameId: "slot-1",
      kind: WagerTransactionKind.Refund,
      money: { amount: "25.00", currency: "BRL" },
      referenceExternalTransactionId: "ext-bet-1",
    });
    expect(refund1.transaction.status).toBe(WagerTransactionStatus.Processed);
    expect(refund1.balance?.amount).toBe("150.00");

    const rollbackWin1 = await processWagerUseCase.execute({
      providerId: "prov-a",
      externalTransactionId: "ext-rb-win-1",
      walletId: wallet.id,
      playerId,
      roundId: "round-1",
      gameId: "slot-1",
      kind: WagerTransactionKind.Rollback,
      money: { amount: "50.00", currency: "BRL" },
      referenceExternalTransactionId: "ext-win-1",
    });
    expect(rollbackWin1.transaction.status).toBe(WagerTransactionStatus.Processed);
    expect(rollbackWin1.balance?.amount).toBe("100.00");

    const fetchedWallet = await getWalletUseCase.execute({ walletId: wallet.id });
    expect(fetchedWallet.balance.amount).toBe("100.00");
    expect(fetchedWallet.version).toBe(5);

    const fetchedTx = await getTxUseCase.execute({
      transactionId: rollbackWin1.transaction.id,
    });
    expect(fetchedTx.status).toBe(WagerTransactionStatus.Processed);

    const page1 = await listLedgerUseCase.execute({ walletId: wallet.id, limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await listLedgerUseCase.execute({
      walletId: wallet.id,
      limit: 2,
      cursor: page1.nextCursor ?? undefined,
    });
    expect(page2.items).toHaveLength(2);

    await expect(
      listLedgerUseCase.execute({ walletId: wallet.id, cursor: "bad-cursor" }),
    ).rejects.toBeInstanceOf(InvalidPaginationCursorError);

    await assertAllWalletsMatchLedger(em, reconcileWalletUseCase);
  });

  it("persists REJECTED transactions with distinct failureCodes (INSUFFICIENT_FUNDS, REVERSAL_WOULD_CAUSE_NEGATIVE_BALANCE, REFERENCE_ALREADY_REVERSED) without mutating balance", async () => {
    const playerId = randomUUID();
    const wallet = await openWalletUseCase.execute({
      playerId,
      initialBalance: { amount: "50.00", currency: "BRL" },
    });

    const rejectedBet = await processWagerUseCase.execute({
      providerId: "prov-a",
      externalTransactionId: "ext-bet-too-high",
      walletId: wallet.id,
      playerId,
      roundId: "round-2",
      gameId: "slot-1",
      kind: WagerTransactionKind.Bet,
      money: { amount: "80.00", currency: "BRL" },
    });
    expect(rejectedBet.transaction.status).toBe(WagerTransactionStatus.Rejected);
    expect(rejectedBet.transaction.failureCode).toBe(FailureCode.InsufficientFunds);
    expect(rejectedBet.balance?.amount).toBe("50.00");

    const winTx = await processWagerUseCase.execute({
      providerId: "prov-a",
      externalTransactionId: "ext-win-big",
      walletId: wallet.id,
      playerId,
      roundId: "round-2",
      gameId: "slot-1",
      kind: WagerTransactionKind.Win,
      money: { amount: "100.00", currency: "BRL" },
    });
    expect(winTx.balance?.amount).toBe("150.00");

    const spendBet = await processWagerUseCase.execute({
      providerId: "prov-a",
      externalTransactionId: "ext-spend-120",
      walletId: wallet.id,
      playerId,
      roundId: "round-2",
      gameId: "slot-1",
      kind: WagerTransactionKind.Bet,
      money: { amount: "120.00", currency: "BRL" },
    });
    expect(spendBet.balance?.amount).toBe("30.00");

    const rejectedRollbackWin = await processWagerUseCase.execute({
      providerId: "prov-a",
      externalTransactionId: "ext-rb-win-big",
      walletId: wallet.id,
      playerId,
      roundId: "round-2",
      gameId: "slot-1",
      kind: WagerTransactionKind.Rollback,
      money: { amount: "100.00", currency: "BRL" },
      referenceExternalTransactionId: "ext-win-big",
    });
    expect(rejectedRollbackWin.transaction.status).toBe(WagerTransactionStatus.Rejected);
    expect(rejectedRollbackWin.transaction.failureCode).toBe(
      FailureCode.ReversalWouldCauseNegativeBalance,
    );
    expect(rejectedRollbackWin.balance?.amount).toBe("30.00");

    const firstRefund = await processWagerUseCase.execute({
      providerId: "prov-a",
      externalTransactionId: "ext-refund-spend-1",
      walletId: wallet.id,
      playerId,
      roundId: "round-2",
      gameId: "slot-1",
      kind: WagerTransactionKind.Refund,
      money: { amount: "120.00", currency: "BRL" },
      referenceExternalTransactionId: "ext-spend-120",
    });
    expect(firstRefund.transaction.status).toBe(WagerTransactionStatus.Processed);
    expect(firstRefund.balance?.amount).toBe("150.00");

    const secondReversal = await processWagerUseCase.execute({
      providerId: "prov-a",
      externalTransactionId: "ext-rollback-spend-dup",
      walletId: wallet.id,
      playerId,
      roundId: "round-2",
      gameId: "slot-1",
      kind: WagerTransactionKind.Rollback,
      money: { amount: "120.00", currency: "BRL" },
      referenceExternalTransactionId: "ext-spend-120",
    });
    expect(secondReversal.transaction.status).toBe(WagerTransactionStatus.Rejected);
    expect(secondReversal.transaction.failureCode).toBe(FailureCode.ReferenceAlreadyReversed);
    expect(secondReversal.balance?.amount).toBe("150.00");

    await assertAllWalletsMatchLedger(em, reconcileWalletUseCase);
  });

  it("handles out-of-order REFUND via PENDING_REFERENCE and resolves it once referenced BET arrives (or times out when missing)", async () => {
    const playerId = randomUUID();
    const wallet = await openWalletUseCase.execute({
      playerId,
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    const earlyRefund = await processWagerUseCase.execute({
      providerId: "prov-a",
      externalTransactionId: "ext-refund-early",
      walletId: wallet.id,
      playerId,
      roundId: "round-ooo",
      gameId: "slot-1",
      kind: WagerTransactionKind.Refund,
      money: { amount: "40.00", currency: "BRL" },
      referenceExternalTransactionId: "ext-bet-late",
    });
    expect(earlyRefund.transaction.status).toBe(WagerTransactionStatus.PendingReference);
    expect(earlyRefund.balance?.amount).toBe("100.00");

    const lateBet = await processWagerUseCase.execute({
      providerId: "prov-a",
      externalTransactionId: "ext-bet-late",
      walletId: wallet.id,
      playerId,
      roundId: "round-ooo",
      gameId: "slot-1",
      kind: WagerTransactionKind.Bet,
      money: { amount: "40.00", currency: "BRL" },
    });
    expect(lateBet.transaction.status).toBe(WagerTransactionStatus.Processed);
    expect(lateBet.balance?.amount).toBe("60.00");

    await em.execute(
      `UPDATE wager_transactions SET next_reference_attempt_at = now() - interval '1 second' WHERE id = ?`,
      [earlyRefund.transaction.id],
    );

    const resolvedCount = await processWagerUseCase.resolvePendingReferenceBatch(10, 5);
    expect(resolvedCount).toBe(1);

    const resolvedRefund = await getTxUseCase.execute({
      transactionId: earlyRefund.transaction.id,
    });
    expect(resolvedRefund.status).toBe(WagerTransactionStatus.Processed);
    expect(resolvedRefund.referenceTransactionId).toBe(lateBet.transaction.id);

    const updatedWallet = await getWalletUseCase.execute({ walletId: wallet.id });
    expect(updatedWallet.balance.amount).toBe("100.00");

    const orphanRefund = await processWagerUseCase.execute({
      providerId: "prov-a",
      externalTransactionId: "ext-refund-orphan",
      walletId: wallet.id,
      playerId,
      roundId: "round-ooo",
      gameId: "slot-1",
      kind: WagerTransactionKind.Refund,
      money: { amount: "10.00", currency: "BRL" },
      referenceExternalTransactionId: "ext-bet-never-arrives",
    });
    expect(orphanRefund.transaction.status).toBe(WagerTransactionStatus.PendingReference);

    await em.execute(
      `UPDATE wager_transactions SET next_reference_attempt_at = now() - interval '1 second' WHERE id = ?`,
      [orphanRefund.transaction.id],
    );

    await processWagerUseCase.resolvePendingReferenceBatch(10, 1);
    const timedOutRefund = await getTxUseCase.execute({
      transactionId: orphanRefund.transaction.id,
    });
    expect(timedOutRefund.status).toBe(WagerTransactionStatus.Rejected);
    expect(timedOutRefund.failureCode).toBe(FailureCode.ReferenceNotFoundTimeout);

    await assertAllWalletsMatchLedger(em, reconcileWalletUseCase);
  });

  it("enforces idempotency replay for matching payloadHash and throws IdempotencyConflictError when payload differs", async () => {
    const playerId = randomUUID();
    const wallet = await openWalletUseCase.execute({
      playerId,
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    const first = await processWagerUseCase.execute({
      providerId: "prov-a",
      externalTransactionId: "ext-idem-1",
      walletId: wallet.id,
      playerId,
      roundId: "round-idem",
      gameId: "slot-1",
      kind: WagerTransactionKind.Bet,
      money: { amount: "25.00", currency: "BRL" },
    });
    expect(first.idempotentReplay).toBe(false);
    expect(first.balance?.amount).toBe("75.00");

    const replayNormalized = await processWagerUseCase.execute({
      providerId: "prov-a",
      externalTransactionId: "ext-idem-1",
      walletId: wallet.id,
      playerId,
      roundId: "round-idem",
      gameId: "slot-1",
      kind: WagerTransactionKind.Bet,
      money: { amount: "25", currency: "BRL" },
    });
    expect(replayNormalized.idempotentReplay).toBe(true);
    expect(replayNormalized.transaction.id).toBe(first.transaction.id);
    expect(replayNormalized.balance?.amount).toBe("75.00");

    await expect(
      processWagerUseCase.execute({
        providerId: "prov-a",
        externalTransactionId: "ext-idem-1",
        walletId: wallet.id,
        playerId,
        roundId: "round-idem",
        gameId: "slot-1",
        kind: WagerTransactionKind.Bet,
        money: { amount: "30.00", currency: "BRL" },
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);

    await assertAllWalletsMatchLedger(em, reconcileWalletUseCase);
  });
});
