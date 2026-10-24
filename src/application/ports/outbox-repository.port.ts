import type { ClaimOutboxBatchOptions } from "@application/ports/outbox-repository.types";
import type { OutboxMessage } from "@domain/messaging/outbox-message";

export type { ClaimOutboxBatchOptions };

export interface OutboxRepositoryPort {
  insert(message: OutboxMessage): Promise<void>;
  insertMany(messages: readonly OutboxMessage[]): Promise<void>;
  claimDueBatch(options: ClaimOutboxBatchOptions): Promise<readonly OutboxMessage[]>;
  update(message: OutboxMessage): Promise<void>;
  countUnpublished(): Promise<number>;
}
