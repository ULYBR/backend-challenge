import { OutboxMessage } from "@domain/messaging/outbox-message";

export interface ClaimOutboxBatchOptions {
  readonly workerId: string;
  readonly now: Date;
  readonly leaseUntil: Date;
  readonly limit: number;
}

export interface OutboxRepositoryPort {
  insert(message: OutboxMessage): Promise<void>;
  insertMany(messages: readonly OutboxMessage[]): Promise<void>;
  claimDueBatch(options: ClaimOutboxBatchOptions): Promise<readonly OutboxMessage[]>;
  update(message: OutboxMessage): Promise<void>;
  countUnpublished(): Promise<number>;
}
