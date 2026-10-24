import type {
  IdempotencyReplaySource,
  RetryComponent,
  TransactionMetricOutcomeInput,
} from "@application/ports/metrics.types";

export type { IdempotencyReplaySource, RetryComponent, TransactionMetricOutcomeInput };

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
