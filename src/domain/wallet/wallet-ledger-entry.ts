import { DomainValidationError } from "@domain/shared/domain-errors";
import { FailureCode } from "@domain/shared/failure-code";
import { Money } from "@domain/shared/money";
import { DIRECTION_ARITHMETIC, LedgerDirection } from "@domain/wallet/ledger-direction";
import {
  CreateLedgerEntryInput,
  CreateLedgerEntryProps,
  LedgerEntryState,
  WalletLedgerEntryOutputDto,
} from "@domain/wallet/wallet.types";

export type {
  CreateLedgerEntryInput,
  CreateLedgerEntryProps,
  LedgerEntryState,
  WalletLedgerEntryOutputDto,
};

export class WalletLedgerEntry {
  public readonly id: string;
  public readonly walletId: string;
  public readonly transactionId: string;
  public readonly walletVersion: number;
  public readonly direction: LedgerDirection;
  public readonly money: Money;
  public readonly balanceBefore: Money;
  public readonly balanceAfter: Money;
  public readonly createdAt: Date;

  private constructor(state: LedgerEntryState) {
    this.id = state.id;
    this.walletId = state.walletId;
    this.transactionId = state.transactionId;
    this.walletVersion = state.walletVersion;
    this.direction = state.direction;
    this.money = state.money;
    this.balanceBefore = state.balanceBefore;
    this.balanceAfter = state.balanceAfter;
    this.createdAt = state.createdAt;
  }

  static create(input: CreateLedgerEntryInput): WalletLedgerEntry {
    WalletLedgerEntry.assertPositiveMoney(input.money);
    WalletLedgerEntry.assertNonNegativeBalance(input.balanceBefore, "balanceBefore");
    WalletLedgerEntry.assertNonNegativeBalance(input.balanceAfter, "balanceAfter");
    WalletLedgerEntry.assertPositiveVersion(input.walletVersion);

    const entry = new WalletLedgerEntry(input);
    entry.assertBalanced();
    return entry;
  }

  static rehydrate(state: LedgerEntryState): WalletLedgerEntry {
    return new WalletLedgerEntry(state);
  }

  isBalanced(): boolean {
    const expectedAfter = DIRECTION_ARITHMETIC[this.direction](this.balanceBefore, this.money);
    return expectedAfter.equals(this.balanceAfter);
  }

  toJSON(): WalletLedgerEntryOutputDto {
    return {
      id: this.id,
      walletId: this.walletId,
      transactionId: this.transactionId,
      walletVersion: this.walletVersion,
      direction: this.direction,
      money: this.money.toJSON(),
      balanceBefore: this.balanceBefore.toJSON(),
      balanceAfter: this.balanceAfter.toJSON(),
      createdAt: this.createdAt.toISOString(),
    };
  }

  private assertBalanced(): void {
    if (!this.isBalanced()) {
      throw new DomainValidationError(
        FailureCode.LedgerEntryUnbalanced,
        `Unbalanced ledger entry '${this.id}' for direction '${this.direction}'`,
      );
    }
  }

  private static assertPositiveMoney(money: Money): void {
    if (!money.isPositive()) {
      throw new DomainValidationError(
        FailureCode.InvalidMoneyAmount,
        "Ledger entry money must be strictly positive",
      );
    }
  }

  private static assertNonNegativeBalance(balance: Money, field: string): void {
    if (balance.isNegative()) {
      throw new DomainValidationError(
        FailureCode.LedgerEntryUnbalanced,
        `Ledger entry ${field} cannot be negative`,
      );
    }
  }

  private static assertPositiveVersion(version: number): void {
    if (!Number.isInteger(version) || version < 1) {
      throw new DomainValidationError(
        FailureCode.LedgerEntryUnbalanced,
        `Invalid walletVersion '${String(version)}' on ledger entry`,
      );
    }
  }
}
