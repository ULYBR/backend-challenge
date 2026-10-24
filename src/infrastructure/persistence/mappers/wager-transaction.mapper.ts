import { FailureCode } from "@domain/shared/failure-code";
import { Money } from "@domain/shared/money";
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from "@domain/wagering/wager-transaction";
import type { WagerTransactionSqlRow } from "@infrastructure/persistence/persistence.types";
import { WagerTransactionRecord } from "@infrastructure/persistence/schemas/wager-transaction.schema";

export type { WagerTransactionSqlRow };

export class WagerTransactionMapper {
  private constructor() {}

  static toDomain(record: WagerTransactionRecord): WagerTransaction {
    const currency = record.currency.trim();
    return WagerTransaction.rehydrate({
      id: record.id,
      providerId: record.providerId,
      externalTransactionId: record.externalTransactionId,
      idempotencyKey: record.idempotencyKey,
      payloadHash: record.payloadHash.trim(),
      walletId: record.walletId,
      playerId: record.playerId,
      roundId: record.roundId,
      gameId: record.gameId,
      kind: record.kind as WagerTransactionKind,
      money: Money.from({ amount: record.amount, currency }),
      referenceExternalTransactionId: record.referenceExternalTransactionId ?? undefined,
      referenceTransactionId: record.referenceTransactionId ?? undefined,
      status: record.status as WagerTransactionStatus,
      failureCode: (record.failureCode as FailureCode | null) ?? undefined,
      recordedBalance:
        record.recordedBalance !== null && record.recordedBalance !== undefined
          ? Money.from({ amount: record.recordedBalance, currency })
          : undefined,
      referenceAttempts: Number(record.referenceAttempts),
      nextReferenceAttemptAt:
        record.nextReferenceAttemptAt !== null && record.nextReferenceAttemptAt !== undefined
          ? new Date(record.nextReferenceAttemptAt)
          : undefined,
      createdAt: new Date(record.createdAt),
      processedAt:
        record.processedAt !== null && record.processedAt !== undefined
          ? new Date(record.processedAt)
          : undefined,
      updatedAt: new Date(record.updatedAt),
    });
  }

  static fromRow(row: WagerTransactionSqlRow): WagerTransaction {
    const currency = row.currency.trim();
    return WagerTransaction.rehydrate({
      id: row.id,
      providerId: row.provider_id,
      externalTransactionId: row.external_transaction_id,
      idempotencyKey: row.idempotency_key,
      payloadHash: row.payload_hash.trim(),
      walletId: row.wallet_id,
      playerId: row.player_id,
      roundId: row.round_id,
      gameId: row.game_id,
      kind: row.kind as WagerTransactionKind,
      money: Money.from({ amount: row.amount, currency }),
      referenceExternalTransactionId: row.reference_external_transaction_id ?? undefined,
      referenceTransactionId: row.reference_transaction_id ?? undefined,
      status: row.status as WagerTransactionStatus,
      failureCode: (row.failure_code as FailureCode | null) ?? undefined,
      recordedBalance:
        row.recorded_balance !== null && row.recorded_balance !== undefined
          ? Money.from({ amount: row.recorded_balance, currency })
          : undefined,
      referenceAttempts: Number(row.reference_attempts),
      nextReferenceAttemptAt:
        row.next_reference_attempt_at !== null && row.next_reference_attempt_at !== undefined
          ? new Date(row.next_reference_attempt_at)
          : undefined,
      createdAt: new Date(row.created_at),
      processedAt:
        row.processed_at !== null && row.processed_at !== undefined
          ? new Date(row.processed_at)
          : undefined,
      updatedAt: new Date(row.updated_at),
    });
  }

  static toRecord(tx: WagerTransaction): WagerTransactionRecord {
    const record = new WagerTransactionRecord();
    record.id = tx.id;
    record.providerId = tx.providerId;
    record.externalTransactionId = tx.externalTransactionId;
    record.idempotencyKey = tx.idempotencyKey;
    record.payloadHash = tx.payloadHash;
    record.walletId = tx.walletId;
    record.playerId = tx.playerId;
    record.roundId = tx.roundId;
    record.gameId = tx.gameId;
    record.kind = tx.kind;
    record.amount = tx.money.amount;
    record.currency = tx.money.currency;
    record.referenceExternalTransactionId = tx.referenceExternalTransactionId ?? null;
    record.referenceTransactionId = tx.referenceTransactionId ?? null;
    record.status = tx.status;
    record.failureCode = tx.failureCode ?? null;
    record.recordedBalance = tx.recordedBalance?.amount ?? null;
    record.referenceAttempts = tx.referenceAttempts;
    record.nextReferenceAttemptAt = tx.nextReferenceAttemptAt ?? null;
    record.createdAt = tx.createdAt;
    record.processedAt = tx.processedAt ?? null;
    record.updatedAt = tx.updatedAt;
    return record;
  }
}
