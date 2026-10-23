import type {
  IdempotencyReplaySource,
  MetricsPort,
  RetryComponent,
  TransactionMetricOutcomeInput,
} from "@application/ports/metrics.port";
import { Injectable } from "@nestjs/common";
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

@Injectable()
export class PrometheusMetricsAdapter implements MetricsPort {
  private readonly registry: Registry;
  private readonly transactionsTotal: Counter<"kind" | "status" | "failure_code">;
  private readonly idempotencyReplaysTotal: Counter<"source">;
  private readonly retriesTotal: Counter<"component" | "reason">;
  private readonly dlqMessagesTotal: Counter<"failure_code">;
  private readonly lockConflictsTotal: Counter;
  private readonly reconciliationInconsistenciesTotal: Counter;
  private readonly outboxUnpublishedGauge: Gauge;
  private readonly processingDurationSeconds: Histogram<"kind" | "status">;

  constructor() {
    this.registry = new Registry();
    collectDefaultMetrics({ register: this.registry });

    this.transactionsTotal = new Counter({
      name: "wager_transactions_total",
      help: "Total number of processed, rejected, pending_reference, or failed wager transactions",
      labelNames: ["kind", "status", "failure_code"],
      registers: [this.registry],
    });

    this.idempotencyReplaysTotal = new Counter({
      name: "wager_idempotency_replays_total",
      help: "Total number of idempotent replays detected",
      labelNames: ["source"],
      registers: [this.registry],
    });

    this.retriesTotal = new Counter({
      name: "wager_retries_total",
      help: "Total number of retries across SQS consumer, outbox publisher, and pending reference worker",
      labelNames: ["component", "reason"],
      registers: [this.registry],
    });

    this.dlqMessagesTotal = new Counter({
      name: "wager_dlq_messages_total",
      help: "Total number of messages routed to the Dead Letter Queue",
      labelNames: ["failure_code"],
      registers: [this.registry],
    });

    this.lockConflictsTotal = new Counter({
      name: "wager_lock_conflicts_total",
      help: "Total number of pessimistic wallet lock timeout conflicts",
      registers: [this.registry],
    });

    this.reconciliationInconsistenciesTotal = new Counter({
      name: "wallet_reconciliation_inconsistencies_total",
      help: "Total number of wallet vs ledger inconsistencies detected during reconciliation",
      registers: [this.registry],
    });

    this.outboxUnpublishedGauge = new Gauge({
      name: "wager_outbox_unpublished_count",
      help: "Current number of unpublished messages in outbox_messages (outbox lag)",
      registers: [this.registry],
    });

    this.processingDurationSeconds = new Histogram({
      name: "wager_processing_duration_seconds",
      help: "Duration of wager transaction processing in seconds",
      labelNames: ["kind", "status"],
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });
  }

  recordTransactionOutcome(input: TransactionMetricOutcomeInput): void {
    const failureCode = input.failureCode ?? "NONE";
    this.transactionsTotal.inc({
      kind: input.kind,
      status: input.status,
      failure_code: failureCode,
    });
    this.processingDurationSeconds.observe(
      { kind: input.kind, status: input.status },
      Math.max(0, input.durationSeconds),
    );
  }

  incrementIdempotencyReplay(source: IdempotencyReplaySource): void {
    this.idempotencyReplaysTotal.inc({ source });
  }

  incrementRetry(component: RetryComponent, reason: string): void {
    this.retriesTotal.inc({ component, reason });
  }

  incrementDlqMessages(failureCode: string): void {
    this.dlqMessagesTotal.inc({ failure_code: failureCode });
  }

  incrementLockConflict(): void {
    this.lockConflictsTotal.inc();
  }

  incrementReconciliationInconsistency(): void {
    this.reconciliationInconsistenciesTotal.inc();
  }

  setOutboxLag(unpublishedCount: number): void {
    this.outboxUnpublishedGauge.set(unpublishedCount);
  }

  async renderPrometheusMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  getContentType(): string {
    return this.registry.contentType;
  }
}
