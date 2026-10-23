import { FailureCode } from "@domain/shared/failure-code";
import { MoneyOutputDto, MoneyProps } from "@domain/shared/money.types";
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from "@domain/wagering/wager-transaction.types";
import { LedgerDirection } from "@domain/wallet/ledger-direction";

export interface ReceiveInboxProps {
  readonly messageId: string;
  readonly consumerName: string;
  readonly payloadHash: string;
  readonly receivedAt?: Date | undefined;
}

export type ReceiveInboxInput = ReceiveInboxProps;

export interface InboxMessageState {
  readonly messageId: string;
  readonly consumerName: string;
  readonly payloadHash: string;
  readonly receivedAt: Date;
  readonly processedAt?: Date | undefined;
}

export interface InboxMessageOutputDto {
  readonly messageId: string;
  readonly consumerName: string;
  readonly payloadHash: string;
  readonly receivedAt: string;
  readonly processedAt?: string | undefined;
}

export interface EnqueueOutboxInput {
  readonly id?: string | undefined;
  readonly aggregateType?: string | undefined;
  readonly event: {
    readonly eventId: string;
    readonly eventType: string;
    readonly version: number;
    readonly aggregateId: string;
    readonly correlationId: string;
    readonly causationId?: string | undefined;
    readonly occurredAt: Date;
    toJSON(): unknown;
  };
}

export interface OutboxMessageState {
  readonly id: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly correlationId: string;
  readonly causationId?: string | undefined;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
  readonly attempts: number;
  readonly nextAttemptAt?: Date | undefined;
  readonly lockedUntil?: Date | undefined;
  readonly lockedBy?: string | undefined;
  readonly publishedAt?: Date | undefined;
  readonly lastError?: string | undefined;
}

export interface OutboxMessageOutputDto {
  readonly id: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly correlationId: string;
  readonly causationId?: string | undefined;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: string;
  readonly attempts: number;
  readonly nextAttemptAt?: string | undefined;
  readonly publishedAt?: string | undefined;
  readonly lastError?: string | undefined;
}

export interface EventContext {
  readonly eventId: string;
  readonly correlationId: string;
  readonly causationId?: string | undefined;
  readonly occurredAt: Date;
}

export interface IntegrationEventProps<T> {
  readonly eventId: string;
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly causationId?: string | undefined;
  readonly occurredAt: Date;
  readonly data: T;
}

export interface SerializedIntegrationEvent<T> {
  readonly eventId: string;
  readonly eventType: string;
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly causationId?: string | undefined;
  readonly occurredAt: string;
  readonly version: number;
  readonly data: T;
}

export interface WalletBalanceChangedData {
  readonly walletId: string;
  readonly transactionId: string;
  readonly direction: LedgerDirection;
  readonly money: MoneyProps;
  readonly balanceBefore: MoneyProps;
  readonly balanceAfter: MoneyProps;
  readonly walletVersion: number;
}

export interface WagerTransactionProcessedData {
  readonly transactionId: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly walletId: string;
  readonly playerId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: WagerTransactionKind;
  readonly status: WagerTransactionStatus.Processed;
  readonly money: MoneyOutputDto;
  readonly balance: MoneyOutputDto;
  readonly referenceTransactionId?: string | undefined;
}

export interface WagerTransactionRejectedData {
  readonly transactionId: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly walletId: string;
  readonly playerId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: WagerTransactionKind;
  readonly status: WagerTransactionStatus.Rejected;
  readonly failureCode: FailureCode;
  readonly money: MoneyOutputDto;
  readonly balance?: MoneyOutputDto | undefined;
}

export interface WagerTransactionPendingReferenceData {
  readonly transactionId: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly referenceExternalTransactionId: string;
  readonly walletId: string;
  readonly playerId: string;
  readonly roundId: string;
  readonly kind: WagerTransactionKind;
  readonly status: WagerTransactionStatus.PendingReference;
  readonly money: MoneyOutputDto;
  readonly attempts: number;
  readonly nextAttemptAt?: string | undefined;
}
