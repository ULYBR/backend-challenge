import {
  EventContext,
  IntegrationEventProps,
  SerializedIntegrationEvent,
  WagerTransactionPendingReferenceData,
  WagerTransactionProcessedData,
  WagerTransactionRejectedData,
  WalletBalanceChangedData,
} from "@domain/messaging/messaging.types";
import { FailureCode } from "@domain/shared/failure-code";
import { MoneyProps } from "@domain/shared/money.types";
import { WagerTransaction, WagerTransactionStatus } from "@domain/wagering/wager-transaction";
import { Wallet } from "@domain/wallet/wallet";
import { WalletLedgerEntry } from "@domain/wallet/wallet-ledger-entry";

export type {
  EventContext,
  IntegrationEventProps,
  SerializedIntegrationEvent,
  WagerTransactionPendingReferenceData,
  WagerTransactionProcessedData,
  WagerTransactionRejectedData,
  WalletBalanceChangedData,
};

export abstract class IntegrationEvent<T> {
  abstract readonly eventType: string;
  abstract readonly version: number;

  readonly eventId: string;
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly causationId?: string | undefined;
  readonly occurredAt: Date;
  readonly data: Readonly<T>;

  protected constructor(props: IntegrationEventProps<T>) {
    this.eventId = props.eventId;
    this.aggregateId = props.aggregateId;
    this.correlationId = props.correlationId;
    this.causationId = props.causationId;
    this.occurredAt = props.occurredAt;
    this.data = Object.freeze({ ...props.data });
  }

  toJSON(): SerializedIntegrationEvent<T> {
    const base: SerializedIntegrationEvent<T> = {
      eventId: this.eventId,
      eventType: this.eventType,
      aggregateId: this.aggregateId,
      correlationId: this.correlationId,
      occurredAt: this.occurredAt.toISOString(),
      version: this.version,
      data: this.data,
      ...(this.causationId !== undefined ? { causationId: this.causationId } : {}),
    };
    return base;
  }
}

export class WalletBalanceChanged extends IntegrationEvent<WalletBalanceChangedData> {
  readonly eventType = "WalletBalanceChanged" as const;
  readonly version = 1 as const;

  static from(wallet: Wallet, entry: WalletLedgerEntry, ctx: EventContext): WalletBalanceChanged {
    return new WalletBalanceChanged({
      eventId: ctx.eventId,
      aggregateId: wallet.id,
      correlationId: ctx.correlationId,
      causationId: ctx.causationId,
      occurredAt: ctx.occurredAt,
      data: {
        walletId: wallet.id,
        transactionId: entry.transactionId,
        direction: entry.direction,
        money: entry.money.toJSON(),
        balanceBefore: entry.balanceBefore.toJSON(),
        balanceAfter: entry.balanceAfter.toJSON(),
        walletVersion: entry.walletVersion,
      },
    });
  }
}

export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionProcessedData> {
  readonly eventType = "WagerTransactionProcessed" as const;
  readonly version = 1 as const;

  static from(
    tx: WagerTransaction,
    balance: MoneyProps,
    ctx: EventContext,
  ): WagerTransactionProcessed {
    return new WagerTransactionProcessed({
      eventId: ctx.eventId,
      aggregateId: tx.id,
      correlationId: ctx.correlationId,
      causationId: ctx.causationId,
      occurredAt: ctx.occurredAt,
      data: {
        transactionId: tx.id,
        providerId: tx.providerId,
        externalTransactionId: tx.externalTransactionId,
        walletId: tx.walletId,
        playerId: tx.playerId,
        roundId: tx.roundId,
        gameId: tx.gameId,
        kind: tx.kind,
        status: WagerTransactionStatus.Processed,
        money: tx.money.toJSON(),
        balance,
        ...(tx.referenceTransactionId !== undefined
          ? { referenceTransactionId: tx.referenceTransactionId }
          : {}),
      },
    });
  }
}

export class WagerTransactionRejected extends IntegrationEvent<WagerTransactionRejectedData> {
  readonly eventType = "WagerTransactionRejected" as const;
  readonly version = 1 as const;

  static from(tx: WagerTransaction, ctx: EventContext): WagerTransactionRejected {
    return new WagerTransactionRejected({
      eventId: ctx.eventId,
      aggregateId: tx.id,
      correlationId: ctx.correlationId,
      causationId: ctx.causationId,
      occurredAt: ctx.occurredAt,
      data: {
        transactionId: tx.id,
        providerId: tx.providerId,
        externalTransactionId: tx.externalTransactionId,
        walletId: tx.walletId,
        playerId: tx.playerId,
        roundId: tx.roundId,
        gameId: tx.gameId,
        kind: tx.kind,
        status: WagerTransactionStatus.Rejected,
        failureCode: tx.failureCode ?? FailureCode.InfrastructurePermanentFailure,
        money: tx.money.toJSON(),
        ...(tx.recordedBalance !== undefined ? { balance: tx.recordedBalance.toJSON() } : {}),
      },
    });
  }
}

export class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionPendingReferenceData> {
  readonly eventType = "WagerTransactionPendingReference" as const;
  readonly version = 1 as const;

  static from(tx: WagerTransaction, ctx: EventContext): WagerTransactionPendingReference {
    return new WagerTransactionPendingReference({
      eventId: ctx.eventId,
      aggregateId: tx.id,
      correlationId: ctx.correlationId,
      causationId: ctx.causationId,
      occurredAt: ctx.occurredAt,
      data: {
        transactionId: tx.id,
        providerId: tx.providerId,
        externalTransactionId: tx.externalTransactionId,
        referenceExternalTransactionId: tx.referenceExternalTransactionId ?? "",
        walletId: tx.walletId,
        playerId: tx.playerId,
        roundId: tx.roundId,
        kind: tx.kind,
        status: WagerTransactionStatus.PendingReference,
        money: tx.money.toJSON(),
        attempts: tx.referenceAttempts,
        ...(tx.nextReferenceAttemptAt !== undefined
          ? { nextAttemptAt: tx.nextReferenceAttemptAt.toISOString() }
          : {}),
      },
    });
  }
}
