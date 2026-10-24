export type IdempotencyReplaySource = "http" | "sqs" | "use_case";

export type RetryComponent = "sqs_consumer" | "outbox_publisher" | "pending_reference";

export interface TransactionMetricOutcomeInput {
  readonly kind: string;
  readonly status: string;
  readonly failureCode?: string | undefined;
  readonly durationSeconds: number;
}
