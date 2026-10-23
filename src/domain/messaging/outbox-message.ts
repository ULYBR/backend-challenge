import { IntegrationEvent } from "@domain/messaging/integration-event";
import {
  EnqueueOutboxInput,
  OutboxMessageOutputDto,
  OutboxMessageState,
} from "@domain/messaging/messaging.types";

export type { EnqueueOutboxInput, OutboxMessageOutputDto, OutboxMessageState };

const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 60_000;

export function calculateExponentialBackoffMs(attempts: number): number {
  const exponent = Math.max(0, Math.min(attempts - 1, 10));
  return Math.min(BASE_BACKOFF_MS * 2 ** exponent, MAX_BACKOFF_MS);
}

export class OutboxMessage {
  public readonly id: string;
  public readonly aggregateType: string;
  public readonly aggregateId: string;
  public readonly eventType: string;
  public readonly eventVersion: number;
  public readonly correlationId: string;
  public readonly causationId: string | undefined;
  public readonly payload: Readonly<Record<string, unknown>>;
  public readonly occurredAt: Date;
  private _attempts: number;
  private _nextAttemptAt: Date | undefined;
  private _lockedUntil: Date | undefined;
  private _lockedBy: string | undefined;
  private _publishedAt: Date | undefined;
  private _lastError: string | undefined;

  private constructor(state: OutboxMessageState) {
    this.id = state.id;
    this.aggregateType = state.aggregateType;
    this.aggregateId = state.aggregateId;
    this.eventType = state.eventType;
    this.eventVersion = state.eventVersion;
    this.correlationId = state.correlationId;
    this.causationId = state.causationId;
    this.payload = state.payload;
    this.occurredAt = state.occurredAt;
    this._attempts = state.attempts;
    this._nextAttemptAt = state.nextAttemptAt;
    this._lockedUntil = state.lockedUntil;
    this._lockedBy = state.lockedBy;
    this._publishedAt = state.publishedAt;
    this._lastError = state.lastError;
  }

  static enqueue(
    eventOrInput: IntegrationEvent<unknown> | EnqueueOutboxInput,
    aggregateType = "WagerTransaction",
  ): OutboxMessage {
    if ("event" in eventOrInput) {
      const { event } = eventOrInput;
      const serialized = event.toJSON() as Readonly<Record<string, unknown>>;
      return new OutboxMessage({
        id: eventOrInput.id ?? event.eventId,
        aggregateType: eventOrInput.aggregateType ?? aggregateType,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        eventVersion: event.version,
        correlationId: event.correlationId,
        causationId: event.causationId,
        payload: serialized,
        occurredAt: event.occurredAt,
        attempts: 0,
        nextAttemptAt: event.occurredAt,
        lockedUntil: undefined,
        lockedBy: undefined,
        publishedAt: undefined,
        lastError: undefined,
      });
    }

    const serialized = eventOrInput.toJSON() as unknown as Readonly<Record<string, unknown>>;
    return new OutboxMessage({
      id: eventOrInput.eventId,
      aggregateType,
      aggregateId: eventOrInput.aggregateId,
      eventType: eventOrInput.eventType,
      eventVersion: eventOrInput.version,
      correlationId: eventOrInput.correlationId,
      causationId: eventOrInput.causationId,
      payload: serialized,
      occurredAt: eventOrInput.occurredAt,
      attempts: 0,
      nextAttemptAt: eventOrInput.occurredAt,
      lockedUntil: undefined,
      lockedBy: undefined,
      publishedAt: undefined,
      lastError: undefined,
    });
  }

  static rehydrate(state: OutboxMessageState): OutboxMessage {
    return new OutboxMessage(state);
  }

  get attempts(): number {
    return this._attempts;
  }

  get nextAttemptAt(): Date | undefined {
    return this._nextAttemptAt;
  }

  get lockedUntil(): Date | undefined {
    return this._lockedUntil;
  }

  get lockedBy(): string | undefined {
    return this._lockedBy;
  }

  get publishedAt(): Date | undefined {
    return this._publishedAt;
  }

  get lastError(): string | undefined {
    return this._lastError;
  }

  isPending(): boolean {
    return this._publishedAt === undefined;
  }

  isDue(now: Date): boolean {
    return (
      this.isPending() &&
      (this._nextAttemptAt === undefined || this._nextAttemptAt.getTime() <= now.getTime())
    );
  }

  markPublished(at: Date): void {
    this._publishedAt = at;
    this._lockedUntil = undefined;
    this._lockedBy = undefined;
    this._lastError = undefined;
  }

  scheduleRetry(now: Date, lastError?: string): void {
    this._attempts += 1;
    const delayMs = calculateExponentialBackoffMs(this._attempts);
    this._nextAttemptAt = new Date(now.getTime() + delayMs);
    this._lockedUntil = undefined;
    this._lockedBy = undefined;
    this._lastError = lastError;
  }

  toJSON(): OutboxMessageOutputDto {
    return {
      id: this.id,
      aggregateType: this.aggregateType,
      aggregateId: this.aggregateId,
      eventType: this.eventType,
      eventVersion: this.eventVersion,
      correlationId: this.correlationId,
      causationId: this.causationId,
      payload: this.payload,
      occurredAt: this.occurredAt.toISOString(),
      attempts: this._attempts,
      nextAttemptAt: this._nextAttemptAt?.toISOString(),
      publishedAt: this._publishedAt?.toISOString(),
      lastError: this._lastError,
    };
  }
}
