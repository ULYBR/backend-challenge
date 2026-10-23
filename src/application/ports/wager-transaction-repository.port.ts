import { WagerTransaction } from "@domain/wagering/wager-transaction";

export interface WagerTransactionRepositoryPort {
  findById(id: string): Promise<WagerTransaction | null>;
  findByExternalTransactionId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null>;
  findByIdempotencyKey(
    providerId: string,
    idempotencyKey: string,
  ): Promise<WagerTransaction | null>;
  findProcessedReversalByReferenceId(
    referenceTransactionId: string,
  ): Promise<WagerTransaction | null>;
  findDuePendingReferenceForUpdateSkipLocked(
    now: Date,
    limit: number,
  ): Promise<readonly WagerTransaction[]>;
  insert(transaction: WagerTransaction): Promise<void>;
  update(transaction: WagerTransaction): Promise<void>;
}
