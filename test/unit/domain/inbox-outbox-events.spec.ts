import { describe, expect, it } from "bun:test";
import { InboxMessage } from "@domain/messaging/inbox-message";
import {
  WagerTransactionPendingReference,
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WalletBalanceChanged,
} from "@domain/messaging/integration-event";
import { OutboxMessage } from "@domain/messaging/outbox-message";
import { FailureCode } from "@domain/shared/failure-code";
import { Money } from "@domain/shared/money";
import { WagerTransaction, WagerTransactionKind } from "@domain/wagering/wager-transaction";
import { Wallet } from "@domain/wallet/wallet";

describe("InboxMessage, OutboxMessage & IntegrationEvent Hierarchy (Sections 6.5 & 11)", () => {
  const t0 = new Date("2026-10-22T18:00:00.000Z");
  const t1 = new Date("2026-10-22T18:00:05.000Z");

  it("tracks InboxMessage processing lifecycle", () => {
    const inbox = InboxMessage.receive({
      consumerName: "wager-consumer",
      messageId: "msg-1",
      payloadHash: "a".repeat(64),
      receivedAt: t0,
    });

    expect(inbox.isProcessed()).toBe(false);
    inbox.markProcessed(t1);
    expect(inbox.isProcessed()).toBe(true);
    expect(inbox.processedAt).toEqual(t1);
  });

  it("builds concrete IntegrationEvents and manages OutboxMessage exponential backoff", () => {
    const wallet = Wallet.open({
      id: "wal-1",
      playerId: "player-1",
      initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
      createdAt: t0,
    });
    const entry = wallet.debit({
      ledgerEntryId: "led-1",
      transactionId: "tx-1",
      amount: Money.from({ amount: "25.00", currency: "BRL" }),
      occurredAt: t1,
    });

    const balanceEvent = WalletBalanceChanged.from(wallet, entry, {
      eventId: "evt-1",
      correlationId: "corr-1",
      causationId: "msg-1",
      occurredAt: t1,
    });

    expect(balanceEvent.eventType).toBe("WalletBalanceChanged");
    expect(balanceEvent.version).toBe(1);
    expect(balanceEvent.toJSON().data.balanceAfter).toEqual({
      amount: "75.00",
      currency: "BRL",
    });

    const outbox = OutboxMessage.enqueue(balanceEvent, "Wallet");
    expect(outbox.isPending()).toBe(true);
    expect(outbox.isDue(t1)).toBe(true);

    outbox.scheduleRetry(t1, "SQS timeout");
    expect(outbox.attempts).toBe(1);
    expect(outbox.isDue(t1)).toBe(false);
    expect(outbox.nextAttemptAt?.getTime()).toBe(t1.getTime() + 1000);

    outbox.markPublished(new Date(t1.getTime() + 1500));
    expect(outbox.isPending()).toBe(false);
  });

  it("serializes WagerTransactionProcessed, WagerTransactionRejected and WagerTransactionPendingReference", () => {
    const tx = WagerTransaction.create({
      id: "tx-1",
      providerId: "prov-a",
      externalTransactionId: "ext-1",
      idempotencyKey: "prov-a:ext-1",
      payloadHash: "a".repeat(64),
      walletId: "wal-1",
      playerId: "player-1",
      roundId: "r-1",
      gameId: "g-1",
      kind: WagerTransactionKind.Rollback,
      money: Money.from({ amount: "25.00", currency: "BRL" }),
      referenceExternalTransactionId: "ext-bet-1",
      createdAt: t0,
    });

    tx.markPendingReference(t1, t0);
    const pendingEvt = WagerTransactionPendingReference.from(tx, {
      eventId: "evt-pend",
      correlationId: "corr-1",
      occurredAt: t0,
    });
    expect(pendingEvt.eventType).toBe("WagerTransactionPendingReference");

    tx.reject(
      FailureCode.ReferenceNotFoundTimeout,
      t1,
      Money.from({ amount: "100.00", currency: "BRL" }),
    );
    const rejectedEvt = WagerTransactionRejected.from(tx, {
      eventId: "evt-rej",
      correlationId: "corr-1",
      occurredAt: t1,
    });
    expect(rejectedEvt.eventType).toBe("WagerTransactionRejected");
    expect(rejectedEvt.data.failureCode).toBe(FailureCode.ReferenceNotFoundTimeout);

    const processedTx = WagerTransaction.create({
      id: "tx-2",
      providerId: "prov-a",
      externalTransactionId: "ext-2",
      idempotencyKey: "prov-a:ext-2",
      payloadHash: "b".repeat(64),
      walletId: "wal-1",
      playerId: "player-1",
      roundId: "r-1",
      gameId: "g-1",
      kind: WagerTransactionKind.Loss,
      money: Money.from({ amount: "25.00", currency: "BRL" }),
      createdAt: t0,
    });
    processedTx.markProcessed(undefined, t1, Money.from({ amount: "100.00", currency: "BRL" }));
    const processedEvt = WagerTransactionProcessed.from(
      processedTx,
      { amount: "100.00", currency: "BRL" },
      { eventId: "evt-proc", correlationId: "corr-1", occurredAt: t1 },
    );
    expect(processedEvt.eventType).toBe("WagerTransactionProcessed");
  });
});
