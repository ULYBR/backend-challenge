import { InboxRepositoryPort } from "@application/ports/inbox-repository.port";
import { InboxMessage } from "@domain/messaging/inbox-message";
import { DuplicateInboxMessageError } from "@domain/shared/domain-errors";
import type { InboxMessageSqlRow } from "@infrastructure/persistence/persistence.types";
import { PostgresErrorHelper } from "@infrastructure/persistence/postgres-error.helper";
import { EntityManager } from "@mikro-orm/postgresql";

export class MikroOrmInboxRepository implements InboxRepositoryPort {
  constructor(private readonly em: EntityManager) {}

  async findByKey(consumerName: string, messageId: string): Promise<InboxMessage | null> {
    const rows = await this.em.execute<InboxMessageSqlRow[]>(
      `SELECT consumer_name, message_id, payload_hash, received_at, processed_at
         FROM inbox_messages
        WHERE consumer_name = ? AND message_id = ?`,
      [consumerName, messageId],
    );
    const row = rows[0];
    if (row === undefined) {
      return null;
    }
    return InboxMessage.rehydrate({
      consumerName: row.consumer_name,
      messageId: row.message_id,
      payloadHash: row.payload_hash.trim(),
      receivedAt: new Date(row.received_at),
      processedAt:
        row.processed_at !== null && row.processed_at !== undefined
          ? new Date(row.processed_at)
          : undefined,
    });
  }

  async insert(message: InboxMessage): Promise<void> {
    try {
      await this.em.execute(
        `INSERT INTO inbox_messages (consumer_name, message_id, payload_hash, received_at, processed_at)
         VALUES (?, ?, ?, ?, ?)`,
        [
          message.consumerName,
          message.messageId,
          message.payloadHash,
          message.receivedAt,
          message.processedAt ?? null,
        ],
      );
    } catch (error) {
      if (PostgresErrorHelper.isUniqueViolation(error, "pk_inbox_messages")) {
        throw new DuplicateInboxMessageError(message.consumerName, message.messageId);
      }
      throw error;
    }
  }

  async update(message: InboxMessage): Promise<void> {
    await this.em.execute(
      `UPDATE inbox_messages
          SET processed_at = ?
        WHERE consumer_name = ? AND message_id = ?`,
      [message.processedAt ?? null, message.consumerName, message.messageId],
    );
  }
}
