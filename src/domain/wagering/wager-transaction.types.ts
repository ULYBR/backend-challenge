import { FailureCode } from "@domain/shared/failure-code";
import { Money } from "@domain/shared/money";
import { MoneyOutputDto } from "@domain/shared/money.types";
import type { WagerTransaction } from "@domain/wagering/wager-transaction";
import { LedgerDirection } from "@domain/wallet/ledger-direction";

export enum WagerTransactionKind {
  Opening = "OPENING",
  Bet = "BET",
  Win = "WIN",
  Loss = "LOSS",
  Refund = "REFUND",
  Rollback = "ROLLBACK",
}

export enum WagerTransactionStatus {
  Pending = "PENDING",
  PendingReference = "PENDING_REFERENCE",
  Processed = "PROCESSED",
  Rejected = "REJECTED",
  Failed = "FAILED",
}

export interface KindPolicy {
  readonly isExternalSubmissible: boolean;
  readonly affectsBalance: boolean;
  readonly requiresReference: boolean;
  readonly allowedReferenceKinds: ReadonlySet<WagerTransactionKind>;
  readonly resolveDirection: (reference?: WagerTransaction) => LedgerDirection;
}

export interface CreateWagerTransactionProps {
  readonly id: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly walletId: string;
  readonly playerId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: WagerTransactionKind;
  readonly money: Money;
  readonly referenceExternalTransactionId?: string | undefined;
  readonly createdAt?: Date | undefined;
}

export type CreateWagerTransactionInput = CreateWagerTransactionProps;

export interface CreateOpeningTransactionInput {
  readonly id: string;
  readonly walletId: string;
  readonly playerId: string;
  readonly initialBalance: Money;
  readonly payloadHash: string;
  readonly createdAt?: Date | undefined;
}

export interface WagerTransactionState {
  readonly id: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly walletId: string;
  readonly playerId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: WagerTransactionKind;
  readonly money: Money;
  readonly referenceExternalTransactionId?: string | undefined;
  readonly createdAt: Date;
  readonly status: WagerTransactionStatus;
  readonly referenceTransactionId?: string | undefined;
  readonly failureCode?: FailureCode | undefined;
  readonly recordedBalance?: Money | undefined;
  readonly referenceAttempts?: number | undefined;
  readonly nextReferenceAttemptAt?: Date | undefined;
  readonly processedAt?: Date | undefined;
  readonly updatedAt?: Date | undefined;
}

export interface WagerTransactionOutputDto {
  readonly id: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly idempotencyKey: string;
  readonly walletId: string;
  readonly playerId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: WagerTransactionKind;
  readonly money: MoneyOutputDto;
  readonly referenceExternalTransactionId?: string | undefined;
  readonly referenceTransactionId?: string | undefined;
  readonly status: WagerTransactionStatus;
  readonly failureCode?: FailureCode | undefined;
  readonly recordedBalance?: MoneyOutputDto | undefined;
  readonly createdAt: string;
  readonly processedAt?: string | undefined;
}
