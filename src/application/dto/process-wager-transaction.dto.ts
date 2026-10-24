import type { FailureCode } from "@domain/shared/failure-code";
import type { MoneyProps } from "@domain/shared/money.types";
import type { WagerTransaction } from "@domain/wagering/wager-transaction";
import {
  WagerTransactionKind,
  type WagerTransactionOutputDto,
} from "@domain/wagering/wager-transaction.types";
import type { Wallet } from "@domain/wallet/wallet";
import type { WalletLedgerEntry } from "@domain/wallet/wallet-ledger-entry";

export interface InboxMessageRegistrationDto {
  readonly consumerName: string;
  readonly messageId: string;
  readonly payloadHash: string;
}

export interface ProcessWagerTransactionInputDto {
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly idempotencyKey?: string | undefined;
  readonly walletId: string;
  readonly playerId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: WagerTransactionKind;
  readonly money: MoneyProps;
  readonly referenceExternalTransactionId?: string | undefined;
  readonly occurredAt?: string | undefined;
  readonly correlationId?: string | undefined;
  readonly causationId?: string | undefined;
  readonly inboxRegistration?: InboxMessageRegistrationDto | undefined;
}

export interface ProcessWagerTransactionOutputDto {
  readonly transaction: WagerTransactionOutputDto;
  readonly balance?: MoneyProps | undefined;
  readonly idempotentReplay: boolean;
}

export interface MovementExecutionInput {
  readonly wallet: Wallet;
  readonly ledgerEntryId: string;
  readonly transaction: WagerTransaction;
  readonly occurredAt: Date;
}

export type WalletMovementStrategy = (input: MovementExecutionInput) => WalletLedgerEntry;

export type ReferenceResolutionOutcome =
  | { readonly kind: "NONE" }
  | { readonly kind: "RESOLVED"; readonly reference: WagerTransaction }
  | { readonly kind: "PENDING_REFERENCE" }
  | { readonly kind: "REJECTED"; readonly failureCode: FailureCode };

export type PersistenceMode = "insert" | "update";
