---
status: Accepted
date: 2026-10-23
deciders: [Time de Engenharia]
rfc: RFC-0012
---

# ADR-0027 — Observabilidade e Tracing Distribuído Unificado com OpenTelemetry e Datadog

## Contexto e problema

O processamento distribuído de apostas envolve múltiplos saltos: requisição HTTP inicial do Provedor de Jogos, transações de banco com lock pessimista, persistência atômica no Transactional Outbox, filas Amazon SQS FIFO particionadas e workers assíncronos.
Embora o sistema já possua logs estruturados Pino e métricas Prometheus (`/metrics`), a ausência de **Tracing Distribuído** padronizado dificulta entender onde uma requisição passou a maior parte do tempo e correlacionar diretamente um log de erro ou auditoria com a árvore de execução completa no **Datadog APM**.

## Drivers da decisão

- **Padrão Aberto CNCF**: Adoção de **OpenTelemetry (OTel)** como padrão agnóstico de instrumentação para evitar lock-in de fornecedor.
- **Integração com Datadog**: Garantir que o `traceId` e `spanId` W3C sejam mapeados nativamente para os atributos do Datadog (`dd.trace_id`, `dd.span_id`), permitindo salto com 1 clique de logs para traces no Datadog.
- **Propagação Fim-a-Fim**: Manter o rastreamento assíncrono através de requisições HTTP (`traceparent`), mensagens SQS e transações de banco de dados.
- **Zero Overhead Excessivo**: Sampling configurável e instrumentação assíncrona leve baseada em `AsyncLocalStorage`.

## Opções consideradas

1. **Apenas logs e métricas manuais sem tracing distribuído**:
   - *Prós:* Simplicidade.
   - *Contras:* Impossível visualizar a cascata de chamadas (API -> Postgres -> Outbox -> SQS -> Consumer) em um gráfico em cascata (flamegraph).
2. **SDK proprietário fechado do Datadog (`dd-trace`)**:
   - *Prós:* Fácil configuração com Datadog.
   - *Contras:* Acoplamento rígido a um fornecedor proprietário; código fica dependente da API do Datadog.
3. **OpenTelemetry API/SDK (W3C TraceContext) com Datadog Exporter/Agent**:
   - *Prós:* 100% aderente ao padrão CNCF da indústria; funciona tanto com Datadog Agent, Grafana Tempo, AWS X-Ray ou OTel Collector; injeta `traceId` e `spanId` nos logs estruturados Pino; compatível com W3C `traceparent`.
   - *Contras:* Exige padronização dos headers de contexto.

## Decisão

Adotamos a **Opção 3**:

1. **Propagação de Contexto W3C TraceContext**:
   - O middleware de tracing extrai ou gera o header W3C `traceparent` (`version-traceId-spanId-traceFlags`).
   - O contexto é registrado no `AsyncLocalStorage` (`CorrelationContext`), propagando `traceId` e `spanId` por toda a cadeia assíncrona de execução da thread.
2. **Correlação Automática nos Logs**:
   - O adaptador de log estruturado (`PinoStructuredLoggerAdapter`) injeta automaticamente os campos `traceId`, `spanId` e os aliases do Datadog `dd.trace_id`, `dd.span_id` em todos os logs JSON emitidos, viabilizando o recurso *Trace-to-Log* do Datadog.
3. **Métricas e Dashboards no Datadog**:
   - O Datadog Agent consome o endpoint `/metrics` Prometheus já existente via OpenMetrics check e coleta os traces enviados via OTLP/Datadog APM.
4. **Configuração de Infraestrutura**:
   - Variáveis padronizadas no Helm/ECS (`OTEL_SERVICE_NAME=distributed-wagering-processor`, `DD_ENV`, `DD_SERVICE`, `DD_VERSION`).

## Consequências

### Positivas

- Visibilidade total do tempo de resposta por camada (tempo no gateway vs tempo no PostgreSQL vs tempo no SQS).
- Rastreamento imediato de falhas: qualquer erro 422, 500 ou lock timeout no log pode ser aberto diretamente no flamegraph do Datadog.
- Código desacoplado de bibliotecas proprietárias, seguindo o padrão aberto OpenTelemetry.

### Negativas / trade-offs

- Exige que proxies de borda (ALB / Ingress) propaguem o header `traceparent` para manter a rastreabilidade contínua.

## Referências

- [RFC-0012](../rfc/RFC-0012-trilha-de-auditoria-fiscalizatoria-e-observabilidade-opentelemetry-datadog.md)
- [ADR-0019](0019-expor-metricas-prometheus-e-logs-estruturados-sem-dados-sensiveis.md)
- [W3C Recommendation: Trace Context](https://www.w3.org/TR/trace-context/)

