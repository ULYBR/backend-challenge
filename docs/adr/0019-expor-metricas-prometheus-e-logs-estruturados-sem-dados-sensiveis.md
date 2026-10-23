# ADR-0019: Expor métricas Prometheus (`prom-client`) via `MetricsPort` e sanitizar payloads financeiros nos logs

- **Status**: Accepted
- **Data**: 2026-10-22
- **Fase do roadmap**: 9 — Observabilidade
- **RFC relacionada**: [RFC-0008](../rfc/RFC-0008-observabilidade-metricas-logs-e-health.md)

## Contexto e problema

A Seção 12 exige logs estruturados JSON com identificadores de correlação sem expor payloads financeiros completos, métricas cobrindo transações por status, duplicatas, retries, DLQ, conflitos de lock, outbox lag e latência de processamento, além de health checks separados para liveness e readiness.

## Opções consideradas

1. **Definir uma porta `MetricsPort` na camada de aplicação implementada por `PrometheusMetricsAdapter` (`prom-client`) com endpoint `GET /metrics`, combinada com `PinoStructuredLoggerAdapter` que remove chaves financeiras por design**
2. **Acoplar chamadas diretas ao `prom-client` dentro dos casos de uso**
3. **Registrar métricas apenas via logs de texto**

## Decisão

Adotar a **Opção 1**:

1. Os casos de uso e workers dependem apenas da interface `MetricsPort` (`TOKENS.METRICS`).
2. `PrometheusMetricsAdapter` mantém um `Registry` dedicado do `prom-client` com todas as métricas obrigatórias da Seção 12 e métricas padrão de runtime Node/Bun.
3. `GET /metrics` atualiza o gauge `wager_outbox_unpublished_count` sob demanda e retorna o formato Prometheus padrão.
4. `PinoStructuredLoggerAdapter` mescla automaticamente o contexto do `AsyncLocalStorage` (`CorrelationContext`) e remove recursivamente chaves sensíveis/financeiras (`money`, `balance`, `amount`, `initialBalance`, `balanceBefore`, `balanceAfter`, `authorization`, `password`, `secret`, `token`).

## Consequências

### Positivas

- Camada de aplicação permanece desacoplada da biblioteca de métricas.
- `GET /metrics` é diretamente raspável por Prometheus, Grafana Agent ou CloudWatch Container Insights / AMP.
- Garantia estrutural de que valores financeiros nunca vazam em logs.

### Negativas / trade-offs

- Pequeno custo de serialização no scrape de `/metrics` (desprezível em intervalos típicos de 15s–30s).

