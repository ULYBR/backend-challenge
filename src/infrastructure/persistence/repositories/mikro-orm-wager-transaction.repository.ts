import { WagerTransactionRepositoryPort } from "@application/ports/wager-transaction-repository.port";
import { DomainValidationError, DuplicateWagerKeyError } from "@domain/shared/domain-errors";
import { FailureCode } from "@domain/shared/failure-code";
import { WagerTransaction } from "@domain/wagering/wager-transaction";
import {
  WagerTransactionMapper,
  WagerTransactionSqlRow,
} from "@infrastructure/persistence/mappers/wager-transaction.mapper";
import { PostgresErrorHelper } from "@infrastructure/persistence/postgres-error.helper";
import { EntityManager } from "@mikro-orm/postgresql";

const SELECT_WAGER_TRANSACTION_COLUMNS = `
  id,
  provider_id,
  external_transaction_id,
  idempotency_key,
  payload_hash,
  wallet_id,
  player_id,
  round_id,
  game_id,
  kind,
  amount,
  currency,
  reference_external_transaction_id,
  reference_transaction_id,
  status,
  failure_code,
  recorded_balance,
  reference_attempts,
  next_reference_attempt_at,
  created_at,
  processed_at,
  updated_at
`;

export class MikroOrmWagerTransactionRepository implements WagerTransactionRepositoryPort {
  constructor(private readonly em: EntityManager) {}

  async findById(id: string): Promise<WagerTransaction | null> {
    const rows = await this.em.execute<WagerTransactionSqlRow[]>(
      `SELECT ${SELECT_WAGER_TRANSACTION_COLUMNS}
         FROM wager_transactions
        WHERE id = ?`,
      [id],
    );
    const row = rows[0];
    return row !== undefined ? WagerTransactionMapper.fromRow(row) : null;
  }

  async findByExternalTransactionId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null> {
    const rows = await this.em.execute<WagerTransactionSqlRow[]>(
      `SELECT ${SELECT_WAGER_TRANSACTION_COLUMNS}
         FROM wager_transactions
        WHERE provider_id = ? AND external_transaction_id = ?`,
      [providerId, externalTransactionId],
    );
    const row = rows[0];
    return row !== undefined ? WagerTransactionMapper.fromRow(row) : null;
  }

  async findByIdempotencyKey(
    providerId: string,
    idempotencyKey: string,
  ): Promise<WagerTransaction | null> {
    const rows = await this.em.execute<WagerTransactionSqlRow[]>(
      `SELECT ${SELECT_WAGER_TRANSACTION_COLUMNS}
         FROM wager_transactions
        WHERE provider_id = ? AND idempotency_key = ?`,
      [providerId, idempotencyKey],
    );
    const row = rows[0];
    return row !== undefined ? WagerTransactionMapper.fromRow(row) : null;
  }

  async findProcessedReversalByReferenceId(
    referenceTransactionId: string,
  ): Promise<WagerTransaction | null> {
    const rows = await this.em.execute<WagerTransactionSqlRow[]>(
      `SELECT ${SELECT_WAGER_TRANSACTION_COLUMNS}
         FROM wager_transactions
        WHERE reference_transaction_id = ?
          AND kind IN ('REFUND', 'ROLLBACK')
          AND status = 'PROCESSED'
        LIMIT 1`,
      [referenceTransactionId],
    );
    const row = rows[0];
    return row !== undefined ? WagerTransactionMapper.fromRow(row) : null;
  }

  async findDuePendingReferenceForUpdateSkipLocked(
    now: Date,
    limit: number,
  ): Promise<readonly WagerTransaction[]> {
    const rows = await this.em.execute<WagerTransactionSqlRow[]>(
      `SELECT ${SELECT_WAGER_TRANSACTION_COLUMNS}
         FROM wager_transactions
        WHERE status = 'PENDING_REFERENCE'
          AND (next_reference_attempt_at IS NULL OR next_reference_attempt_at <= ?)
        ORDER BY next_reference_attempt_at ASC NULLS FIRST, created_at ASC
        LIMIT ?
          FOR UPDATE SKIP LOCKED`,
      [now, limit],
    );
    return rows.map((row) => WagerTransactionMapper.fromRow(row));
  }

  async insert(transaction: WagerTransaction): Promise<void> {
    try {
      await this.em.execute(
        `INSERT INTO wager_transactions (
          id,
          provider_id,
          external_transaction_id,
          idempotency_key,
          payload_hash,
          wallet_id,
          player_id,
          round_id,
          game_id,
          kind,
          amount,
          currency,
          reference_external_transaction_id,
          reference_transaction_id,
          status,
          failure_code,
          recorded_balance,
          reference_attempts,
          next_reference_attempt_at,
          created_at,
          processed_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          transaction.id,
          transaction.providerId,
          transaction.externalTransactionId,
          transaction.idempotencyKey,
          transaction.payloadHash,
          transaction.walletId,
          transaction.playerId,
          transaction.roundId,
          transaction.gameId,
          transaction.kind,
          transaction.money.amount,
          transaction.money.currency,
          transaction.referenceExternalTransactionId ?? null,
          transaction.referenceTransactionId ?? null,
          transaction.status,
          transaction.failureCode ?? null,
          transaction.recordedBalance?.amount ?? null,
          transaction.referenceAttempts,
          transaction.nextReferenceAttemptAt ?? null,
          transaction.createdAt,
          transaction.processedAt ?? null,
          transaction.updatedAt,
        ],
      );
    } catch (error) {
      this.rethrowMappedConstraintError(error, transaction);
    }
  }

  async update(transaction: WagerTransaction): Promise<void> {
    try {
      await this.em.execute(
        `UPDATE wager_transactions
            SET reference_transaction_id = ?,
                status = ?,
                failure_code = ?,
                recorded_balance = ?,
                reference_attempts = ?,
                next_reference_attempt_at = ?,
                processed_at = ?,
                updated_at = ?
          WHERE id = ?`,
        [
          transaction.referenceTransactionId ?? null,
          transaction.status,
          transaction.failureCode ?? null,
          transaction.recordedBalance?.amount ?? null,
          transaction.referenceAttempts,
          transaction.nextReferenceAttemptAt ?? null,
          transaction.processedAt ?? null,
          transaction.updatedAt,
          transaction.id,
        ],
      );
    } catch (error) {
      this.rethrowMappedConstraintError(error, transaction);
    }
  }

  private rethrowMappedConstraintError(error: unknown, transaction: WagerTransaction): never {
    if (PostgresErrorHelper.isUniqueViolation(error, "uq_wager_transactions__single_reversal")) {
      throw new DomainValidationError(
        FailureCode.ReferenceAlreadyReversed,
        `Referenced transaction '${transaction.referenceTransactionId}' has already been reversed`,
      );
    }
    if (
      PostgresErrorHelper.isUniqueViolation(error, "uq_wager_transactions__provider_external_tx") ||
      PostgresErrorHelper.isUniqueViolation(
        error,
        "uq_wager_transactions__provider_idempotency_key",
      )
    ) {
      throw new DuplicateWagerKeyError(transaction.providerId, transaction.externalTransactionId);
    }
    throw error;
  }
}
