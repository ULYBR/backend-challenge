# RFCs

Template em [0000-template.md](0000-template.md). Ciclo de vida: `Draft → In Review → Accepted → Implemented`
(ou `Rejected` / `Withdrawn`).

| RFC | Título | Status | Fase |
|---|---|---|---|
| [RFC-0001](RFC-0001-stack-scaffolding-e-topologia.md) | Stack tecnológica, scaffolding hexagonal e topologia de execução | Implemented | 1 |
| [RFC-0002](RFC-0002-modelagem-de-dados-e-relacionamentos.md) | Modelagem de dados, design de relacionamentos e invariantes no schema PostgreSQL | Implemented | 2 |
| [RFC-0003](RFC-0003-modelo-de-dominio-e-maquina-de-estados.md) | Modelo de domínio puro, políticas declarativas e máquina de estados | Implemented | 3 |
| [RFC-0004](RFC-0004-pipeline-de-processamento-concorrencia-e-idempotencia.md) | Pipeline de processamento transacional, controle de concorrência por carteira e idempotência persistente | Implemented | 4 |
| [RFC-0005](RFC-0005-api-http-validacao-e-tratamento-de-erros.md) | API HTTP REST, validação de contratos com Zod, filtro declarativo de erros e paginação por cursor | Implemented | 5 |
| [RFC-0006](RFC-0006-consumer-sqs-inbox-dlq-e-shutdown.md) | Consumidor SQS FIFO com Inbox persistente, classificação declarativa de falhas, DLQ e graceful shutdown | Implemented | 6 |
| [RFC-0007](RFC-0007-transactional-outbox-e-workers-assincronos.md) | Transactional Outbox Publisher concorrente com lease e resolução assíncrona de referências pendentes | Implemented | 7–8 |
| [RFC-0008](RFC-0008-observabilidade-metricas-logs-e-health.md) | Observabilidade com métricas Prometheus (`/metrics`), logs JSON estruturados e health checks | Implemented | 9 |
| [RFC-0009](RFC-0009-suite-concorrencia-multi-instancia-e-teste-de-carga.md) | Suíte completa de concorrência multi-instância (8 cenários da Seção 13) e benchmark de carga | Implemented | 11 |
| [RFC-0010](RFC-0010-padronizacao-rotas-api-v1-e-documentacao-dual-redoc-swagger.md) | Padronização de rotas RESTful com prefixo /api/v1 e documentação dual ReDoc e Swagger UI | Implemented | 10 |
| [RFC-0011](RFC-0011-diagramas-de-fluxo-na-documentacao-openapi.md) | Diagramas de Fluxo e Sequência na Documentação OpenAPI (ReDoc & Swagger) | Implemented | 14 |
| [RFC-0012](RFC-0012-trilha-de-auditoria-fiscalizatoria-e-observabilidade-opentelemetry-datadog.md) | Trilha de Auditoria Fiscalizatória em Parquet/Athena e Observabilidade Unificada com OpenTelemetry e Datadog | Implemented | 15 |
