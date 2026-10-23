export type IdempotencyReplaySource = "http" | "sqs" | "use_case";

export type RetryComponent = "sqs_consumer" | "outbox_publisher" | "pending_reference";

export interface TransactionMetricOutcomeInput {
  readonly kind: string;
  readonly status: string;
  readonly failureCode?: string | undefined;
  readonly durationSeconds: number;
}

export interface MetricsPort {
  recordTransactionOutcome(input: TransactionMetricOutcomeInput): void;
  incrementIdempotencyReplay(source: IdempotencyReplaySource): void;
  incrementRetry(component: RetryComponent, reason: string): void;
  incrementDlqMessages(failureCode: string): void;
  incrementLockConflict(): void;
  incrementReconciliationInconsistency(): void;
  setOutboxLag(unpublishedCount: number): void;
  renderPrometheusMetrics(): Promise<string>;
  getContentType(): string;
}
