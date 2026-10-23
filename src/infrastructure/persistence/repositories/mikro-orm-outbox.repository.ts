import { createHash } from "node:crypto";
import {
  ClaimOutboxBatchOptions,
  OutboxRepositoryPort,
} from "@application/ports/outbox-repository.port";
import { OutboxMessage } from "@domain/messaging/outbox-message";
import {
  OutboxMessageMapper,
  OutboxMessageSqlRow,
} from "@infrastructure/persistence/mappers/outbox-message.mapper";
import { EntityManager } from "@mikro-orm/postgresql";

const UUID_FORMAT_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toPostgresUuid(raw: string): string {
  if (UUID_FORMAT_REGEX.test(raw)) {
    return raw.toLowerCase();
  }
  const hex = createHash("sha256").update(raw).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export class MikroOrmOutboxRepository implements OutboxRepositoryPort {
  constructor(private readonly em: EntityManager) {}

  async insert(message: OutboxMessage): Promise<void> {
    await this.em.execute(
      `INSERT INTO outbox_messages (
        id,
        aggregate_type,
        aggregate_id,
        event_type,
        event_version,
        correlation_id,
        causation_id,
        payload,
        occurred_at,
        attempts,
        next_attempt_at,
        locked_until,
        locked_by,
        published_at,
        last_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?, ?, ?, ?)`,
      [
        message.id,
        message.aggregateType,
        message.aggregateId,
        message.eventType,
        message.eventVersion,
        toPostgresUuid(message.correlationId),
        message.causationId !== undefined ? toPostgresUuid(message.causationId) : null,
        JSON.stringify(message.payload),
        message.occurredAt,
        message.attempts,
        message.nextAttemptAt ?? message.occurredAt,
        message.lockedUntil ?? null,
        message.lockedBy ?? null,
        message.publishedAt ?? null,
        message.lastError ?? null,
      ],
    );
  }

  async insertMany(messages: readonly OutboxMessage[]): Promise<void> {
    for (const message of messages) {
      await this.insert(message);
    }
  }

  async claimDueBatch(options: ClaimOutboxBatchOptions): Promise<readonly OutboxMessage[]> {
    const rows = await this.em.execute<OutboxMessageSqlRow[]>(
      `UPDATE outbox_messages
          SET locked_by = ?,
              locked_until = ?
        WHERE id IN (
          SELECT id
            FROM outbox_messages
           WHERE published_at IS NULL
             AND next_attempt_at <= ?
             AND (locked_until IS NULL OR locked_until <= ?)
           ORDER BY next_attempt_at ASC, occurred_at ASC
           LIMIT ?
             FOR UPDATE SKIP LOCKED
        )
        RETURNING
          id,
          aggregate_type,
          aggregate_id,
          event_type,
          event_version,
          correlation_id,
          causation_id,
          payload,
          occurred_at,
          attempts,
          next_attempt_at,
          locked_until,
          locked_by,
          published_at,
          last_error`,
      [options.workerId, options.leaseUntil, options.now, options.now, options.limit],
    );
    return rows.map((row) => OutboxMessageMapper.fromRow(row));
  }

  async update(message: OutboxMessage): Promise<void> {
    await this.em.execute(
      `UPDATE outbox_messages
          SET attempts = ?,
              next_attempt_at = ?,
              locked_until = ?,
              locked_by = ?,
              published_at = ?,
              last_error = ?
        WHERE id = ?`,
      [
        message.attempts,
        message.nextAttemptAt ?? message.occurredAt,
        message.lockedUntil ?? null,
        message.lockedBy ?? null,
        message.publishedAt ?? null,
        message.lastError ?? null,
        message.id,
      ],
    );
  }

  async countUnpublished(): Promise<number> {
    const rows = await this.em.execute<Array<{ readonly count: string }>>(
      `SELECT COUNT(*)::text AS count
         FROM outbox_messages
        WHERE published_at IS NULL`,
    );
    return Number(rows[0]?.count ?? "0");
  }
}
