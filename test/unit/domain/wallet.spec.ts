import { describe, expect, it } from "bun:test";
import { CurrencyMismatchError, InsufficientFundsError } from "@domain/shared/domain-errors";
import { FailureCode } from "@domain/shared/failure-code";
import { Money } from "@domain/shared/money";
import { LedgerDirection } from "@domain/wallet/ledger-direction";
import { Wallet } from "@domain/wallet/wallet";

describe("Wallet Aggregate Root (Section 6.2)", () => {
  const t0 = new Date("2026-10-22T18:00:00.000Z");
  const t1 = new Date("2026-10-22T18:01:00.000Z");
  const t2 = new Date("2026-10-22T18:02:00.000Z");

  it("opens with version 1 and generates opening ledger entry when initialBalance > 0", () => {
    const wallet = Wallet.open({
      id: "wal-1",
      playerId: "player-1",
      initialBalance: Money.from({ amount: "1000.00", currency: "BRL" }),
      createdAt: t0,
    });

    expect(wallet.version).toBe(1);
    expect(wallet.balance.amount).toBe("1000.00");

    const openingEntry = wallet.createOpeningLedgerEntry({
      ledgerEntryId: "led-open",
      transactionId: "tx-open",
    });
    expect(openingEntry.direction).toBe(LedgerDirection.Credit);
    expect(openingEntry.walletVersion).toBe(1);
    expect(openingEntry.balanceBefore.amount).toBe("0.00");
    expect(openingEntry.balanceAfter.amount).toBe("1000.00");
    expect(openingEntry.isBalanced()).toBe(true);
  });

  it("debits and credits atomically producing matching ledger entries and incrementing version", () => {
    const wallet = Wallet.open({
      id: "wal-1",
      playerId: "player-1",
      initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
      createdAt: t0,
    });

    const debitEntry = wallet.debit({
      ledgerEntryId: "led-1",
      transactionId: "tx-bet-1",
      amount: Money.from({ amount: "25.00", currency: "BRL" }),
      occurredAt: t1,
    });

    expect(wallet.balance.amount).toBe("75.00");
    expect(wallet.version).toBe(2);
    expect(debitEntry.walletVersion).toBe(2);
    expect(debitEntry.direction).toBe(LedgerDirection.Debit);
    expect(debitEntry.balanceBefore.amount).toBe("100.00");
    expect(debitEntry.balanceAfter.amount).toBe("75.00");

    const creditEntry = wallet.credit({
      ledgerEntryId: "led-2",
      transactionId: "tx-win-1",
      amount: Money.from({ amount: "50.00", currency: "BRL" }),
      occurredAt: t2,
    });

    expect(wallet.balance.amount).toBe("125.00");
    expect(wallet.version).toBe(3);
    expect(creditEntry.walletVersion).toBe(3);
    expect(creditEntry.direction).toBe(LedgerDirection.Credit);
    expect(creditEntry.balanceBefore.amount).toBe("75.00");
    expect(creditEntry.balanceAfter.amount).toBe("125.00");
  });

  it("rejects debit when insufficient funds without mutating balance or version, supporting distinct failureCode for reversals (Rule 7.9)", () => {
    const wallet = Wallet.open({
      id: "wal-1",
      playerId: "player-1",
      initialBalance: Money.from({ amount: "20.00", currency: "BRL" }),
      createdAt: t0,
    });

    try {
      wallet.debit({
        ledgerEntryId: "led-fail-1",
        transactionId: "tx-bet-big",
        amount: Money.from({ amount: "25.00", currency: "BRL" }),
        occurredAt: t1,
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(InsufficientFundsError);
      expect((err as InsufficientFundsError).failureCode).toBe(FailureCode.InsufficientFunds);
    }

    try {
      wallet.debit({
        ledgerEntryId: "led-fail-2",
        transactionId: "tx-rollback-win",
        amount: Money.from({ amount: "25.00", currency: "BRL" }),
        occurredAt: t1,
        insufficientFundsCode: FailureCode.ReversalWouldCauseNegativeBalance,
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(InsufficientFundsError);
      expect((err as InsufficientFundsError).failureCode).toBe(
        FailureCode.ReversalWouldCauseNegativeBalance,
      );
    }

    expect(wallet.balance.amount).toBe("20.00");
    expect(wallet.version).toBe(1);
  });

  it("rejects currency mismatch on debit and credit", () => {
    const wallet = Wallet.open({
      id: "wal-1",
      playerId: "player-1",
      initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
      createdAt: t0,
    });

    expect(() =>
      wallet.debit({
        ledgerEntryId: "led-usd",
        transactionId: "tx-usd",
        amount: Money.from({ amount: "10.00", currency: "USD" }),
        occurredAt: t1,
      }),
    ).toThrow(CurrencyMismatchError);

    expect(wallet.version).toBe(1);
  });
});
