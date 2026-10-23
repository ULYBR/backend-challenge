import { describe, expect, it } from "bun:test";
import { DomainValidationError, InvalidTransactionStateError } from "@domain/shared/domain-errors";
import { FailureCode } from "@domain/shared/failure-code";
import { Money } from "@domain/shared/money";
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from "@domain/wagering/wager-transaction";
import { LedgerDirection } from "@domain/wallet/ledger-direction";

describe("WagerTransaction & Declarative State Machine (Section 6.3, 7 & ADR-0010)", () => {
  const now = new Date("2026-10-22T18:00:00.000Z");

  function makeTx(
    kind: WagerTransactionKind,
    overrides?: {
      id?: string;
      referenceExternalTransactionId?: string;
      amount?: string;
      currency?: string;
      roundId?: string;
    },
  ): WagerTransaction {
    return WagerTransaction.create({
      id: overrides?.id ?? "tx-1",
      providerId: "prov-a",
      externalTransactionId: `ext-${overrides?.id ?? "1"}`,
      idempotencyKey: `prov-a:ext-${overrides?.id ?? "1"}`,
      payloadHash: "a".repeat(64),
      walletId: "wal-1",
      playerId: "player-1",
      roundId: overrides?.roundId ?? "round-1",
      gameId: "fortune-chimp",
      kind,
      money: Money.from({
        amount: overrides?.amount ?? "25.00",
        currency: overrides?.currency ?? "BRL",
      }),
      referenceExternalTransactionId: overrides?.referenceExternalTransactionId,
      createdAt: now,
    });
  }

  it("forbids external creation of OPENING transactions", () => {
    expect(() => makeTx(WagerTransactionKind.Opening)).toThrow(DomainValidationError);
  });

  it("requires referenceExternalTransactionId for REFUND and ROLLBACK", () => {
    expect(() => makeTx(WagerTransactionKind.Refund)).toThrow(DomainValidationError);
    expect(() => makeTx(WagerTransactionKind.Rollback)).toThrow(DomainValidationError);

    const validRefund = makeTx(WagerTransactionKind.Refund, {
      referenceExternalTransactionId: "ext-bet-1",
    });
    expect(validRefund.requiresReference()).toBe(true);
    expect(validRefund.status).toBe(WagerTransactionStatus.Pending);
  });

  it("computes affectsBalance() and ledgerDirectionFor() declaratively for all kinds", () => {
    const bet = makeTx(WagerTransactionKind.Bet, { id: "bet-1" });
    const win = makeTx(WagerTransactionKind.Win, { id: "win-1" });
    const loss = makeTx(WagerTransactionKind.Loss, { id: "loss-1" });
    const refund = makeTx(WagerTransactionKind.Refund, {
      id: "ref-1",
      referenceExternalTransactionId: "ext-bet-1",
    });
    const rollbackBet = makeTx(WagerTransactionKind.Rollback, {
      id: "rb-bet",
      referenceExternalTransactionId: "ext-bet-1",
    });
    const rollbackWin = makeTx(WagerTransactionKind.Rollback, {
      id: "rb-win",
      referenceExternalTransactionId: "ext-win-1",
    });

    expect(bet.affectsBalance()).toBe(true);
    expect(bet.ledgerDirectionFor()).toBe(LedgerDirection.Debit);

    expect(win.affectsBalance()).toBe(true);
    expect(win.ledgerDirectionFor()).toBe(LedgerDirection.Credit);

    expect(loss.affectsBalance()).toBe(false);
    expect(() => loss.ledgerDirectionFor()).toThrow(DomainValidationError);

    expect(refund.affectsBalance()).toBe(true);
    expect(refund.ledgerDirectionFor(bet)).toBe(LedgerDirection.Credit);

    expect(rollbackBet.ledgerDirectionFor(bet)).toBe(LedgerDirection.Credit);
    expect(rollbackWin.ledgerDirectionFor(win)).toBe(LedgerDirection.Debit);
    expect(rollbackBet.ledgerDirectionFor(refund)).toBe(LedgerDirection.Debit);
  });

  it("enforces terminal states (PROCESSED, REJECTED, FAILED) and throws InvalidTransactionStateError on re-transition", () => {
    const tx = makeTx(WagerTransactionKind.Bet);
    expect(tx.isTerminal()).toBe(false);

    tx.markPendingReference(new Date(now.getTime() + 1000), now);
    expect(tx.status).toBe(WagerTransactionStatus.PendingReference);
    expect(tx.referenceAttempts).toBe(1);
    expect(tx.isTerminal()).toBe(false);

    tx.markProcessed(undefined, now, Money.from({ amount: "75.00", currency: "BRL" }));
    expect(tx.status).toBe(WagerTransactionStatus.Processed);
    expect(tx.isTerminal()).toBe(true);

    expect(() => tx.reject(FailureCode.InsufficientFunds, now)).toThrow(
      InvalidTransactionStateError,
    );
    expect(() => tx.fail(FailureCode.InfrastructurePermanentFailure, now)).toThrow(
      InvalidTransactionStateError,
    );
    expect(() => tx.markPendingReference(now, now)).toThrow(InvalidTransactionStateError);
  });

  it("validates reference target rules (context, PROCESSED status, allowed kind, exact amount)", () => {
    const bet = makeTx(WagerTransactionKind.Bet, { id: "bet-1", amount: "25.00" });
    bet.markProcessed(undefined, now);

    const win = makeTx(WagerTransactionKind.Win, { id: "win-1", amount: "25.00" });
    win.markProcessed(undefined, now);

    const refundValid = makeTx(WagerTransactionKind.Refund, {
      id: "ref-ok",
      referenceExternalTransactionId: "ext-bet-1",
      amount: "25.00",
    });
    expect(refundValid.validateReferenceTarget(bet)).toBeUndefined();

    expect(refundValid.validateReferenceTarget(win)).toBe(FailureCode.InvalidReferenceKind);

    const refundWrongAmount = makeTx(WagerTransactionKind.Refund, {
      id: "ref-amt",
      referenceExternalTransactionId: "ext-bet-1",
      amount: "10.00",
    });
    expect(refundWrongAmount.validateReferenceTarget(bet)).toBe(
      FailureCode.ReferenceAmountMismatch,
    );

    const refundWrongRound = makeTx(WagerTransactionKind.Refund, {
      id: "ref-rnd",
      referenceExternalTransactionId: "ext-bet-1",
      amount: "25.00",
      roundId: "other-round",
    });
    expect(refundWrongRound.validateReferenceTarget(bet)).toBe(
      FailureCode.ReferenceContextMismatch,
    );
  });

  it("verifies payloadHash equality via matchesPayload()", () => {
    const tx = makeTx(WagerTransactionKind.Bet);
    expect(tx.matchesPayload("a".repeat(64))).toBe(true);
    expect(tx.matchesPayload("b".repeat(64))).toBe(false);
  });
});
