import {
  CurrencyMismatchError,
  DomainValidationError,
  InsufficientFundsError,
} from "@domain/shared/domain-errors";
import { FailureCode } from "@domain/shared/failure-code";
import { Money } from "@domain/shared/money";
import { LedgerDirection } from "@domain/wallet/ledger-direction";
import { WalletLedgerEntry } from "@domain/wallet/wallet-ledger-entry";
import {
  OpenWalletInput,
  OpenWalletProps,
  OpeningLedgerEntryInput,
  WalletMovementInput,
  WalletMovementProps,
  WalletOutputDto,
  WalletState,
} from "@domain/wallet/wallet.types";

export type {
  OpeningLedgerEntryInput,
  OpenWalletInput,
  OpenWalletProps,
  WalletMovementInput,
  WalletMovementProps,
  WalletOutputDto,
  WalletState,
};

export class Wallet {
  public readonly id: string;
  public readonly playerId: string;
  public readonly currency: string;
  public readonly createdAt: Date;
  private _balance: Money;
  private _version: number;
  private _updatedAt: Date;

  private constructor(state: WalletState) {
    this.id = state.id;
    this.playerId = state.playerId;
    this.currency = state.currency;
    this._balance = state.balance;
    this._version = state.version;
    this.createdAt = state.createdAt;
    this._updatedAt = state.updatedAt;
  }

  static open(input: OpenWalletInput): Wallet {
    Wallet.assertNonNegativeInitialBalance(input.initialBalance);
    const now = input.createdAt ?? new Date();
    return new Wallet({
      id: input.id,
      playerId: input.playerId,
      currency: input.initialBalance.currency,
      balance: input.initialBalance,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
  }

  static rehydrate(state: WalletState): Wallet {
    return new Wallet(state);
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  debit(input: WalletMovementInput): WalletLedgerEntry {
    this.assertSameCurrency(input.amount);
    Wallet.assertPositiveMovement(input.amount);

    const balanceBefore = this._balance;
    const balanceAfter = balanceBefore.subtract(input.amount);
    if (balanceAfter.isNegative()) {
      throw new InsufficientFundsError(
        this.id,
        input.insufficientFundsCode ?? FailureCode.InsufficientFunds,
      );
    }

    this._balance = balanceAfter;
    this._version += 1;
    this._updatedAt = input.occurredAt;

    return WalletLedgerEntry.create({
      id: input.ledgerEntryId,
      walletId: this.id,
      transactionId: input.transactionId,
      walletVersion: this._version,
      direction: LedgerDirection.Debit,
      money: input.amount,
      balanceBefore,
      balanceAfter,
      createdAt: input.occurredAt,
    });
  }

  credit(input: WalletMovementInput): WalletLedgerEntry {
    this.assertSameCurrency(input.amount);
    Wallet.assertPositiveMovement(input.amount);

    const balanceBefore = this._balance;
    const balanceAfter = balanceBefore.add(input.amount);

    this._balance = balanceAfter;
    this._version += 1;
    this._updatedAt = input.occurredAt;

    return WalletLedgerEntry.create({
      id: input.ledgerEntryId,
      walletId: this.id,
      transactionId: input.transactionId,
      walletVersion: this._version,
      direction: LedgerDirection.Credit,
      money: input.amount,
      balanceBefore,
      balanceAfter,
      createdAt: input.occurredAt,
    });
  }

  createOpeningLedgerEntry(input: OpeningLedgerEntryInput): WalletLedgerEntry {
    Wallet.assertPositiveMovement(this._balance);
    return WalletLedgerEntry.create({
      id: input.ledgerEntryId,
      walletId: this.id,
      transactionId: input.transactionId,
      walletVersion: this._version,
      direction: LedgerDirection.Credit,
      money: this._balance,
      balanceBefore: Money.zero(this.currency),
      balanceAfter: this._balance,
      createdAt: input.occurredAt ?? this.createdAt,
    });
  }

  assertSameCurrency(money: Money): void {
    if (this.currency !== money.currency) {
      throw new CurrencyMismatchError(this.currency, money.currency);
    }
  }

  toJSON(): WalletOutputDto {
    return {
      id: this.id,
      playerId: this.playerId,
      balance: this._balance.toJSON(),
      version: this._version,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this._updatedAt.toISOString(),
    };
  }

  private static assertNonNegativeInitialBalance(money: Money): void {
    if (money.isNegative()) {
      throw new DomainValidationError(
        FailureCode.InvalidMoneyAmount,
        "Wallet initialBalance cannot be negative",
      );
    }
  }

  private static assertPositiveMovement(money: Money): void {
    if (!money.isPositive()) {
      throw new DomainValidationError(
        FailureCode.InvalidMoneyAmount,
        "Wallet movement amount must be strictly positive",
      );
    }
  }
}
