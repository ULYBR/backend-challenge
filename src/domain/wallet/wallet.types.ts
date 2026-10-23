import { FailureCode } from "@domain/shared/failure-code";
import { Money } from "@domain/shared/money";
import { MoneyOutputDto } from "@domain/shared/money.types";
import { LedgerDirection } from "@domain/wallet/ledger-direction";

export interface CreateLedgerEntryProps {
  readonly id: string;
  readonly walletId: string;
  readonly transactionId: string;
  readonly walletVersion: number;
  readonly direction: LedgerDirection;
  readonly money: Money;
  readonly balanceBefore: Money;
  readonly balanceAfter: Money;
  readonly createdAt: Date;
}

export type CreateLedgerEntryInput = CreateLedgerEntryProps;
export type LedgerEntryState = CreateLedgerEntryProps;

export interface WalletLedgerEntryOutputDto {
  readonly id: string;
  readonly walletId: string;
  readonly transactionId: string;
  readonly walletVersion: number;
  readonly direction: LedgerDirection;
  readonly money: MoneyOutputDto;
  readonly balanceBefore: MoneyOutputDto;
  readonly balanceAfter: MoneyOutputDto;
  readonly createdAt: string;
}

export interface OpenWalletProps {
  readonly id: string;
  readonly playerId: string;
  readonly initialBalance: Money;
  readonly createdAt?: Date | undefined;
}

export type OpenWalletInput = OpenWalletProps;

export interface WalletState {
  readonly id: string;
  readonly playerId: string;
  readonly currency: string;
  readonly balance: Money;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface WalletMovementProps {
  readonly ledgerEntryId: string;
  readonly transactionId: string;
  readonly amount: Money;
  readonly occurredAt: Date;
  readonly insufficientFundsCode?:
    | FailureCode.InsufficientFunds
    | FailureCode.ReversalWouldCauseNegativeBalance
    | undefined;
}

export type WalletMovementInput = WalletMovementProps;

export interface OpeningLedgerEntryInput {
  readonly ledgerEntryId: string;
  readonly transactionId: string;
  readonly occurredAt?: Date | undefined;
}

export interface WalletOutputDto {
  readonly id: string;
  readonly playerId: string;
  readonly balance: MoneyOutputDto;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}
