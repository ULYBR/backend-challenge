import { describe, expect, it } from "bun:test";
import { DomainValidationError } from "@domain/shared/domain-errors";
import { Money } from "@domain/shared/money";
import { LedgerDirection } from "@domain/wallet/ledger-direction";
import { WalletLedgerEntry } from "@domain/wallet/wallet-ledger-entry";

describe("WalletLedgerEntry (Section 6.4)", () => {
  const now = new Date("2026-10-22T18:00:00.000Z");

  it("creates balanced CREDIT and DEBIT ledger entries", () => {
    const credit = WalletLedgerEntry.create({
      id: "entry-1",
      walletId: "wal-1",
      transactionId: "tx-1",
      walletVersion: 1,
      direction: LedgerDirection.Credit,
      money: Money.from({ amount: "100.00", currency: "BRL" }),
      balanceBefore: Money.zero("BRL"),
      balanceAfter: Money.from({ amount: "100.00", currency: "BRL" }),
      createdAt: now,
    });
    expect(credit.isBalanced()).toBe(true);

    const debit = WalletLedgerEntry.create({
      id: "entry-2",
      walletId: "wal-1",
      transactionId: "tx-2",
      walletVersion: 2,
      direction: LedgerDirection.Debit,
      money: Money.from({ amount: "25.00", currency: "BRL" }),
      balanceBefore: Money.from({ amount: "100.00", currency: "BRL" }),
      balanceAfter: Money.from({ amount: "75.00", currency: "BRL" }),
      createdAt: now,
    });
    expect(debit.isBalanced()).toBe(true);
  });

  it("rejects unbalanced arithmetic on creation", () => {
    expect(() =>
      WalletLedgerEntry.create({
        id: "entry-bad",
        walletId: "wal-1",
        transactionId: "tx-bad",
        walletVersion: 2,
        direction: LedgerDirection.Debit,
        money: Money.from({ amount: "25.00", currency: "BRL" }),
        balanceBefore: Money.from({ amount: "100.00", currency: "BRL" }),
        balanceAfter: Money.from({ amount: "80.00", currency: "BRL" }),
        createdAt: now,
      }),
    ).toThrow(DomainValidationError);
  });
});
