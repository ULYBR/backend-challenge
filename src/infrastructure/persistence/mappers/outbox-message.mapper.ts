import { OutboxMessage } from "@domain/messaging/outbox-message";
import { OutboxMessageRecord } from "@infrastructure/persistence/schemas/outbox-message.schema";

export interface OutboxMessageSqlRow {
  readonly id: string;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly event_type: string;
  readonly event_version: number;
  readonly correlation_id: string;
  readonly causation_id: string | null;
  readonly payload: Record<string, unknown> | string;
  readonly occurred_at: Date | string;
  readonly attempts: number;
  readonly next_attempt_at: Date | string;
  readonly locked_until: Date | string | null;
  readonly locked_by: string | null;
  readonly published_at: Date | string | null;
  readonly last_error: string | null;
}

export class OutboxMessageMapper {
  private constructor() {}

  static toDomain(record: OutboxMessageRecord): OutboxMessage {
    return OutboxMessage.rehydrate({
      id: record.id,
      aggregateType: record.aggregateType,
      aggregateId: record.aggregateId,
      eventType: record.eventType,
      eventVersion: Number(record.eventVersion),
      correlationId: record.correlationId,
      causationId: record.causationId ?? undefined,
      payload: record.payload,
      occurredAt: new Date(record.occurredAt),
      attempts: Number(record.attempts),
      nextAttemptAt: new Date(record.nextAttemptAt),
      lockedUntil:
        record.lockedUntil !== null && record.lockedUntil !== undefined
          ? new Date(record.lockedUntil)
          : undefined,
      lockedBy: record.lockedBy ?? undefined,
      publishedAt:
        record.publishedAt !== null && record.publishedAt !== undefined
          ? new Date(record.publishedAt)
          : undefined,
      lastError: record.lastError ?? undefined,
    });
  }

  static fromRow(row: OutboxMessageSqlRow): OutboxMessage {
    const parsedPayload: Record<string, unknown> =
      typeof row.payload === "string"
        ? (JSON.parse(row.payload) as Record<string, unknown>)
        : row.payload;

    return OutboxMessage.rehydrate({
      id: row.id,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      eventType: row.event_type,
      eventVersion: Number(row.event_version),
      correlationId: row.correlation_id,
      causationId: row.causation_id ?? undefined,
      payload: parsedPayload,
      occurredAt: new Date(row.occurred_at),
      attempts: Number(row.attempts),
      nextAttemptAt: new Date(row.next_attempt_at),
      lockedUntil:
        row.locked_until !== null && row.locked_until !== undefined
          ? new Date(row.locked_until)
          : undefined,
      lockedBy: row.locked_by ?? undefined,
      publishedAt:
        row.published_at !== null && row.published_at !== undefined
          ? new Date(row.published_at)
          : undefined,
      lastError: row.last_error ?? undefined,
    });
  }

  static toRecord(message: OutboxMessage): OutboxMessageRecord {
    const record = new OutboxMessageRecord();
    record.id = message.id;
    record.aggregateType = message.aggregateType;
    record.aggregateId = message.aggregateId;
    record.eventType = message.eventType;
    record.eventVersion = message.eventVersion;
    record.correlationId = message.correlationId;
    record.causationId = message.causationId ?? null;
    record.payload = message.payload;
    record.occurredAt = message.occurredAt;
    record.attempts = message.attempts;
    record.nextAttemptAt = message.nextAttemptAt ?? message.occurredAt;
    record.lockedUntil = message.lockedUntil ?? null;
    record.lockedBy = message.lockedBy ?? null;
    record.publishedAt = message.publishedAt ?? null;
    record.lastError = message.lastError ?? null;
    return record;
  }
}
