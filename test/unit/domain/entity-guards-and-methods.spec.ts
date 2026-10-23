import { describe, expect, it } from "bun:test";
import { InboxMessage } from "@domain/messaging/inbox-message";
import { OutboxMessage } from "@domain/messaging/outbox-message";
import { DomainValidationError } from "@domain/shared/domain-errors";
import { FailureCode } from "@domain/shared/failure-code";
import { Money } from "@domain/shared/money";
import { WagerTransaction, WagerTransactionKind } from "@domain/wagering/wager-transaction";
import { LedgerDirection } from "@domain/wallet/ledger-direction";
import { Wallet } from "@domain/wallet/wallet";
import { WalletLedgerEntry } from "@domain/wallet/wallet-ledger-entry";

describe("Domain Entity Guard Clauses & Edge Methods", () => {
  it("enforces WagerTransaction guard clauses and validation branches", () => {
    expect(() =>
      WagerTransaction.create({
        id: "tx-neg",
        providerId: "p-1",
        externalTransactionId: "ext-neg",
        idempotencyKey: "idemp-neg",
        payloadHash: "hash",
        walletId: "w-1",
        playerId: "pl-1",
        roundId: "r-1",
        gameId: "g-1",
        kind: WagerTransactionKind.Bet,
        money: Money.zero("USD"),
        createdAt: new Date(),
      }),
    ).toThrow(DomainValidationError);

    const refundTx = WagerTransaction.create({
      id: "tx-ref",
      providerId: "p-1",
      externalTransactionId: "ext-ref",
      idempotencyKey: "idemp-ref",
      payloadHash: "hash",
      walletId: "w-1",
      playerId: "pl-1",
      roundId: "r-1",
      gameId: "g-1",
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: "ext-bet",
      money: Money.from({ amount: "10.00", currency: "USD" }),
      createdAt: new Date(),
    });

    expect(() => refundTx.markProcessed(undefined, new Date())).toThrow(DomainValidationError);

    const betTx = WagerTransaction.create({
      id: "tx-bet",
      providerId: "p-1",
      externalTransactionId: "ext-bet",
      idempotencyKey: "idemp-bet",
      payloadHash: "hash",
      walletId: "w-1",
      playerId: "pl-1",
      roundId: "r-1",
      gameId: "g-1",
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: "10.00", currency: "USD" }),
      createdAt: new Date(),
    });

    const pendingRefResult = refundTx.validateReferenceTarget(betTx);
    expect(pendingRefResult).toBe(FailureCode.ReferenceNotProcessed);

    betTx.markProcessed(undefined, new Date());
    const validRefResult = refundTx.validateReferenceTarget(betTx);
    expect(validRefResult).toBeUndefined();

    const rollbackTx = WagerTransaction.create({
      id: "tx-roll",
      providerId: "p-1",
      externalTransactionId: "ext-roll",
      idempotencyKey: "idemp-roll",
      payloadHash: "hash",
      walletId: "w-1",
      playerId: "pl-1",
      roundId: "r-1",
      gameId: "g-1",
      kind: WagerTransactionKind.Rollback,
      referenceExternalTransactionId: "ext-bet",
      money: Money.from({ amount: "10.00", currency: "USD" }),
      createdAt: new Date(),
    });

    expect(() => rollbackTx.ledgerDirectionFor(undefined)).toThrow(DomainValidationError);

    const diffCurrencyBet = WagerTransaction.create({
      id: "tx-diff",
      providerId: "p-1",
      externalTransactionId: "ext-diff",
      idempotencyKey: "idemp-diff",
      payloadHash: "hash",
      walletId: "w-1",
      playerId: "pl-1",
      roundId: "r-1",
      gameId: "g-1",
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: "10.00", currency: "EUR" }),
      createdAt: new Date(),
    });
    diffCurrencyBet.markProcessed(undefined, new Date());
    expect(refundTx.validateReferenceTarget(diffCurrencyBet)).toBe(
      FailureCode.ReferenceContextMismatch,
    );

    const diffPlayerBet = WagerTransaction.create({
      id: "tx-diff-player",
      providerId: "p-1",
      externalTransactionId: "ext-diff-player",
      idempotencyKey: "idemp-diff-player",
      payloadHash: "hash",
      walletId: "w-1",
      playerId: "other-player",
      roundId: "r-1",
      gameId: "g-1",
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: "10.00", currency: "USD" }),
      createdAt: new Date(),
    });
    diffPlayerBet.markProcessed(undefined, new Date());
    expect(refundTx.validateReferenceTarget(diffPlayerBet)).toBe(
      FailureCode.ReferenceContextMismatch,
    );

    const serialized = refundTx.toJSON();
    expect(serialized.id).toBe("tx-ref");
    expect(serialized.kind).toBe(WagerTransactionKind.Refund);
  });

  it("enforces Wallet movement guards and checks negative initial balance", () => {
    const wallet = Wallet.open({
      id: "w-1",
      playerId: "p-1",
      initialBalance: Money.from({ amount: "100.00", currency: "USD" }),
      createdAt: new Date(),
    });

    expect(() =>
      wallet.debit({
        ledgerEntryId: "le-0",
        transactionId: "tx-zero",
        amount: Money.zero("USD"),
        occurredAt: new Date(),
      }),
    ).toThrow(DomainValidationError);

    expect(() =>
      wallet.credit({
        ledgerEntryId: "le-0-c",
        transactionId: "tx-zero-c",
        amount: Money.zero("USD"),
        occurredAt: new Date(),
      }),
    ).toThrow(DomainValidationError);

    const negativeMoney = Money.rehydrate({ amount: "-10.00", currency: "USD" });
    expect(() =>
      Wallet.open({
        id: "w-neg",
        playerId: "p-1",
        initialBalance: negativeMoney,
        createdAt: new Date(),
      }),
    ).toThrow(DomainValidationError);

    const serializedWallet = wallet.toJSON();
    expect(serializedWallet.id).toBe("w-1");
    expect(serializedWallet.balance.amount).toBe("100.00");
  });

  it("enforces WalletLedgerEntry validation guards", () => {
    expect(() =>
      WalletLedgerEntry.create({
        id: "le-bad-ver",
        walletId: "w-1",
        transactionId: "tx-1",
        walletVersion: 0,
        direction: LedgerDirection.Credit,
        money: Money.from({ amount: "10.00", currency: "USD" }),
        balanceBefore: Money.zero("USD"),
        balanceAfter: Money.from({ amount: "10.00", currency: "USD" }),
        createdAt: new Date(),
      }),
    ).toThrow(DomainValidationError);

    expect(() =>
      WalletLedgerEntry.create({
        id: "le-bad-money",
        walletId: "w-1",
        transactionId: "tx-1",
        walletVersion: 1,
        direction: LedgerDirection.Credit,
        money: Money.zero("USD"),
        balanceBefore: Money.zero("USD"),
        balanceAfter: Money.zero("USD"),
        createdAt: new Date(),
      }),
    ).toThrow(DomainValidationError);

    const negativeBalance = Money.rehydrate({ amount: "-5.00", currency: "USD" });
    expect(() =>
      WalletLedgerEntry.create({
        id: "le-neg-bal",
        walletId: "w-1",
        transactionId: "tx-1",
        walletVersion: 1,
        direction: LedgerDirection.Debit,
        money: Money.from({ amount: "5.00", currency: "USD" }),
        balanceBefore: negativeBalance,
        balanceAfter: Money.zero("USD"),
        createdAt: new Date(),
      }),
    ).toThrow(DomainValidationError);

    const entry = WalletLedgerEntry.create({
      id: "le-ok",
      walletId: "w-1",
      transactionId: "tx-1",
      walletVersion: 1,
      direction: LedgerDirection.Credit,
      money: Money.from({ amount: "10.00", currency: "USD" }),
      balanceBefore: Money.zero("USD"),
      balanceAfter: Money.from({ amount: "10.00", currency: "USD" }),
      createdAt: new Date(),
    });
    const serializedEntry = entry.toJSON();
    expect(serializedEntry.id).toBe("le-ok");
    expect(serializedEntry.direction).toBe(LedgerDirection.Credit);
  });

  it("exercises OutboxMessage and InboxMessage state management", () => {
    const outbox = OutboxMessage.rehydrate({
      id: "out-1",
      aggregateType: "Wallet",
      aggregateId: "w-1",
      eventType: "WalletBalanceChanged",
      eventVersion: 1,
      correlationId: "c-1",
      payload: { key: "val" },
      occurredAt: new Date(),
      attempts: 0,
      nextAttemptAt: new Date(Date.now() - 1000),
    });

    expect(outbox.isPending()).toBe(true);
    expect(outbox.isDue(new Date())).toBe(true);

    outbox.scheduleRetry(new Date(), "SQS network error");
    expect(outbox.attempts).toBe(1);
    expect(outbox.lastError).toBe("SQS network error");

    outbox.markPublished(new Date());
    expect(outbox.isPending()).toBe(false);
    expect(outbox.publishedAt).toBeDefined();

    const serializedOutbox = outbox.toJSON();
    expect(serializedOutbox.id).toBe("out-1");
    expect(serializedOutbox.aggregateType).toBe("Wallet");

    const inbox = InboxMessage.receive({
      consumerName: "wager-consumer",
      messageId: "msg-1",
      payloadHash: "hash-inbox-1",
      receivedAt: new Date(),
    });
    expect(inbox.isProcessed()).toBe(false);
    expect(inbox.matchesPayload("hash-inbox-1")).toBe(true);
    expect(inbox.matchesPayload("other-hash")).toBe(false);
    inbox.markProcessed(new Date());
    expect(inbox.isProcessed()).toBe(true);
    expect(inbox.processedAt).toBeDefined();

    const rehydratedInbox = InboxMessage.rehydrate({
      consumerName: "wager-consumer",
      messageId: "msg-rehydrated",
      payloadHash: "hash-rehydrated",
      receivedAt: new Date(),
      processedAt: new Date(),
    });
    expect(rehydratedInbox.isProcessed()).toBe(true);

    const serializedInbox = rehydratedInbox.toJSON();
    expect(serializedInbox.messageId).toBe("msg-rehydrated");
  });
});
