---
rfc: RFC-0008
title: Observabilidade com métricas Prometheus (/metrics), logs JSON estruturados e health checks
status: Implemented
author: Ulysses Andrade Leal
created: 2026-10-22
updated: 2026-10-22
phase: 9
adrs: [ADR-0019]
---

# RFC-0008 — Observabilidade com métricas Prometheus (`/metrics`), logs JSON estruturados e health checks

## 1. Resumo

Especifica a instrumentação completa de observabilidade exigida na Seção 12 do desafio:
1. **Porta de métricas (`MetricsPort`) e adaptador Prometheus (`PrometheusMetricsAdapter` via `prom-client`)** exposto em `GET /metrics`.
2. **Métricas obrigatórias de negócio e infraestrutura**:
   - `wager_transactions_total{kind, status, failure_code}` (Counter — transações por status/tipo/falha)
   - `wager_idempotency_replays_total{source}` (Counter — duplicatas/replays detectados)
   - `wager_retries_total{component, reason}` (Counter — retries de consumer, outbox e referências pendentes)
   - `wager_dlq_messages_total{failure_code}` (Counter — mensagens enviadas à DLQ)
   - `wager_lock_conflicts_total` (Counter — timeouts/conflitos de lock pessimista na carteira)
   - `wager_outbox_unpublished_count` (Gauge — outbox lag atual)
   - `wager_processing_duration_seconds{kind, status}` (Histogram — latência de processamento de transações)
   - `wallet_reconciliation_inconsistencies_total` (Counter — divergências detectadas na reconciliação)
3. **Logs estruturados JSON (`PinoStructuredLoggerAdapter` + `CorrelationContext`)**: propagação automática de `correlationId`, `messageId`, `transactionId`, `walletId`, `providerId`, `roundId` e `instanceId`, com sanitização estrita de campos financeiros (`money`, `balance`, `amount`, `initialBalance`).
4. **Health checks separados**: `GET /health/live` (liveness) e `GET /health/ready` (readiness verificando PostgreSQL e filas SQS).

## 2. Motivação e escopo

Em um processador financeiro distribuído e autoescalável (`APP_ROLE=api|consumer|outbox|scheduler`), métricas como `wager_outbox_unpublished_count` (outbox lag), `wager_lock_conflicts_total` e `wager_processing_duration_seconds` não apenas alimentam alertas de SRE, como também servem de sinal direto para políticas de *Application Auto Scaling* no ECS/CloudWatch/Prometheus.

## 3. Desenho detalhado

### 3.1 Contrato `MetricsPort` (`src/application/ports/metrics.port.ts`)

```ts
export interface MetricsPort {
  recordTransactionOutcome(params: {
    readonly kind: string;
    readonly status: string;
    readonly failureCode?: string | undefined;
    readonly durationSeconds: number;
  }): void;
  incrementIdempotencyReplay(source: "http" | "sqs" | "use_case"): void;
  incrementRetry(component: "sqs_consumer" | "outbox_publisher" | "pending_reference", reason: string): void;
  incrementDlqMessages(failureCode: string): void;
  incrementLockConflict(): void;
  incrementReconciliationInconsistency(): void;
  setOutboxLag(unpublishedCount: number): void;
  renderPrometheusMetrics(): Promise<string>;
  getContentType(): string;
}
```

### 3.2 Endpoint `GET /metrics` (`MetricsController`)

- Atualiza o gauge `wager_outbox_unpublished_count` consultando `outboxRepository.countUnpublished()` e retorna o payload no formato texto oficial do Prometheus (`text/plain; version=0.0.4; charset=utf-8`).

## 4. Plano de testes

- **Integração (`test/integration/observability/metrics-and-health.spec.ts`)**:
  - Executa transações `PROCESSED`, `REJECTED`, replay idempotente, envio para DLQ e publicação de Outbox.
  - Consulta `GET /metrics` e verifica a presença e incremento real de todas as métricas exigidas na Seção 12 (`wager_transactions_total`, `wager_idempotency_replays_total`, `wager_retries_total`, `wager_dlq_messages_total`, `wager_lock_conflicts_total`, `wager_outbox_unpublished_count`, `wager_processing_duration_seconds`).
  - Verifica `GET /health/live` e `GET /health/ready`.
