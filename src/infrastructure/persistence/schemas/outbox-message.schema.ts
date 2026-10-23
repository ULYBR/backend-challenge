import { EntitySchema } from "@mikro-orm/core";

export class OutboxMessageRecord {
  id!: string;
  aggregateType!: string;
  aggregateId!: string;
  eventType!: string;
  eventVersion!: number;
  correlationId!: string;
  causationId!: string | null;
  payload!: Record<string, unknown>;
  occurredAt!: Date;
  attempts!: number;
  nextAttemptAt!: Date;
  lockedUntil!: Date | null;
  lockedBy!: string | null;
  publishedAt!: Date | null;
  lastError!: string | null;
}

export const OutboxMessageEntitySchema = new EntitySchema<OutboxMessageRecord>({
  class: OutboxMessageRecord,
  tableName: "outbox_messages",
  properties: {
    id: { type: "uuid", primary: true, fieldName: "id" },
    aggregateType: { type: "text", fieldName: "aggregate_type" },
    aggregateId: { type: "uuid", fieldName: "aggregate_id" },
    eventType: { type: "text", fieldName: "event_type" },
    eventVersion: { type: "integer", fieldName: "event_version" },
    correlationId: { type: "uuid", fieldName: "correlation_id" },
    causationId: { type: "uuid", nullable: true, fieldName: "causation_id" },
    payload: { type: "json", fieldName: "payload" },
    occurredAt: { type: "Date", fieldName: "occurred_at" },
    attempts: { type: "integer", fieldName: "attempts" },
    nextAttemptAt: { type: "Date", fieldName: "next_attempt_at" },
    lockedUntil: { type: "Date", nullable: true, fieldName: "locked_until" },
    lockedBy: { type: "text", nullable: true, fieldName: "locked_by" },
    publishedAt: { type: "Date", nullable: true, fieldName: "published_at" },
    lastError: { type: "text", nullable: true, fieldName: "last_error" },
  },
});
