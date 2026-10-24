# Arquitetura — Distributed Wagering Processor

> Documento vivo: atualizado ao fim de cada fase do [ROADMAP](docs/ROADMAP.md). Cada seção aponta para os RFCs
> e ADRs que registram as decisões.

## 1. Visão geral

O **Distributed Wagering Processor** é um monólito modular em **Arquitetura Hexagonal (Ports & Adapters)**
parametrizado por papéis de execução (`APP_ROLE=api|consumer|outbox|scheduler|all`). O núcleo financeiro
(`src/domain`) é 100% puro e livre de dependências de framework, ORM ou transporte.

Detalhes do desenho estrutural e da topologia:
- [RFC-0001 — Stack tecnológica, scaffolding hexagonal e topologia de execução](docs/rfc/RFC-0001-stack-scaffolding-e-topologia.md)
- [ADR-0006 — Estruturar a aplicação como monólito modular parametrizado por papéis (APP_ROLE)](docs/adr/0006-estruturar-topologia-em-modular-monolith-por-papeis.md)

## 2. Stack e justificativas

| Componente | Escolha | Decisão |
|---|---|---|
| Runtime / PM / Test runner | Bun 1.x | [ADR-0002](docs/adr/0002-adotar-stack-base-bun-typescript-nestjs-postgres.md) |
| Linguagem | TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) | [ADR-0002](docs/adr/0002-adotar-stack-base-bun-typescript-nestjs-postgres.md) |
| Framework | NestJS 11 | [ADR-0002](docs/adr/0002-adotar-stack-base-bun-typescript-nestjs-postgres.md) |
| ORM e estratégia transacional | MikroORM v6 (`EntitySchema` + Persistence Records + Mappers `rehydrate` + `EntityManager.transactional()`) | [ADR-0003](docs/adr/0003-usar-mikroorm-com-entity-schema-sem-decorators-no-dominio.md) |
| Banco de dados | PostgreSQL 17 | [ADR-0002](docs/adr/0002-adotar-stack-base-bun-typescript-nestjs-postgres.md) |
| Identificadores | UUIDv7 gerado na aplicação (`Bun.randomUUIDv7()`) | [ADR-0004](docs/adr/0004-gerar-identificadores-com-uuidv7-na-aplicacao.md) |
| Mensageria SQS | `@aws-sdk/client-sqs` + MiniStack (compatível com LocalStack via `AWS_ENDPOINT_URL`) | [ADR-0005](docs/adr/0005-adotar-ministack-como-emulador-sqs-padrao.md) |
| Validação / Lint | Zod + Biome | [ADR-0002](docs/adr/0002-adotar-stack-base-bun-typescript-nestjs-postgres.md) |
| Segurança e OWASP | RateLimitGuard (Sliding Window), SecurityHeadersMiddleware (HSTS, CSP), Trivy e Gitleaks | [ADR-0022](docs/adr/0022-mitigacao-owasp-api-security-e-rate-limiting.md) |
| Documentação Dual & Padrão de Rotas | OpenAPI 3.1 + ReDoc (3 colunas Zé Delivery em `/docs`) + Swagger UI interativo (`/docs/swagger`) + prefixo `/api/v1` | [ADR-0023](docs/adr/0023-adotar-prefixo-api-v1-e-documentacao-dual-redoc-swagger.md) · [RFC-0010](docs/rfc/RFC-0010-padronizacao-rotas-api-v1-e-documentacao-dual-redoc-swagger.md) |


## 3. Modelo de dados e garantias no schema

Todas as invariantes financeiras (unicidade, não-negatividade, aritmética de saldo, imutabilidade de ledger e de
estados terminais, reversão única e consistência de moeda/player) são aplicadas diretamente no PostgreSQL via
chaves compostas, `CHECK` constraints, partial unique indexes e triggers PL/pgSQL:

- [RFC-0002 — Modelagem de dados, design de relacionamentos e invariantes no schema PostgreSQL](docs/rfc/RFC-0002-modelagem-de-dados-e-relacionamentos.md)
- [Diagrama ER e fluxo transacional](docs/diagrams/er-diagram.md)
- [ADR-0007 — Representar Money com bigint em unidades menores no domínio e NUMERIC(19,2) no PostgreSQL](docs/adr/0007-representar-money-com-bigint-no-dominio-e-numeric-no-banco.md)
- [ADR-0008 — Modelar enums no PostgreSQL com colunas TEXT e CHECK constraints](docs/adr/0008-modelar-enums-no-postgres-com-text-e-check-constraints.md)
- [ADR-0009 — Garantir invariantes financeiras no schema PostgreSQL combinando FKs compostas, partial unique indexes e triggers](docs/adr/0009-garantir-invariantes-financeiras-no-schema-postgres.md)

## 4. Modelo de domínio

O núcleo de domínio (`src/domain/`) implementa `Money`, `Wallet`, `WagerTransaction`, `WalletLedgerEntry`,
`InboxMessage`, `OutboxMessage` e `IntegrationEvent<T>` com construtores `private`/`protected` e factories
estáticas (`from`, `zero`, `open`, `create`, `receive`, `enqueue`, `rehydrate`). As variações por
`WagerTransactionKind`, `WagerTransactionStatus` e `LedgerDirection` são governadas por tabelas de políticas
declarativas (`KIND_POLICIES`, `ALLOWED_STATUS_TRANSITIONS`, `DIRECTION_ARITHMETIC`), eliminando ramificações
`if / else / switch`:

- [RFC-0003 — Modelo de domínio puro, políticas declarativas e máquina de estados](docs/rfc/RFC-0003-modelo-de-dominio-e-maquina-de-estados.md)
- [ADR-0010 — Expressar a máquina de estados e as regras por tipo de transação com mapas declarativos em vez de condicionais](docs/adr/0010-maquina-de-estados-e-politicas-declarativas-no-dominio.md)

## 5. Concorrência e idempotência

O pipeline transacional (`ProcessWagerTransactionUseCase` + `MikroOrmUnitOfWork`) serializa mutações por
carteira com lock pessimista (`SELECT ... FROM wallets WHERE id = $1 FOR UPDATE`) e `SET LOCAL lock_timeout`
configurável, preservando paralelismo total entre carteiras distintas. A idempotência é persistente no
PostgreSQL por `(provider_id, external_transaction_id)` e `(provider_id, idempotency_key)` combinada com
`payload_hash` SHA-256 canônico (normalizando strings e escala monetária `Money.amount` em 2 casas decimais):

- [RFC-0004 — Pipeline de processamento transacional, controle de concorrência por carteira e idempotência persistente](docs/rfc/RFC-0004-pipeline-de-processamento-concorrencia-e-idempotencia.md)
- [ADR-0011 — Usar lock pessimista por carteira (`SELECT ... FOR UPDATE`) combinado com versão e invariantes de schema](docs/adr/0011-usar-lock-pessimista-por-wallet-com-defesa-em-profundidade.md)
- [ADR-0012 — Garantir idempotência persistente por `(provider_id, external_transaction_id)` e `payload_hash` SHA-256 canônico](docs/adr/0012-garantir-idempotencia-persistente-e-hash-canonico-sha256.md)
- [ADR-0014 — Aplicar política de reversão única por transação referenciada e validação estrita de `referenceTransactionId`](docs/adr/0014-aplicar-politica-de-reversao-unica-e-validacao-de-referencia.md)

## 6. Mensageria, Inbox e Outbox

O consumo assíncrono (`WagerTransactionsSqsConsumer`, `APP_ROLE=consumer`) reutiliza o mesmo
`ProcessWagerTransactionUseCase` da entrada HTTP, registrando `(consumer_name, message_id)` em `inbox_messages`
na mesma transação SQL e executando `DeleteMessage` no SQS **somente após o commit**. Falhas são classificadas
declarativamente em `ACK_TERMINAL`, `RETRY_TRANSIENT` (com backoff exponencial até `SQS_MAX_RECEIVE_COUNT`) e
`PERMANENT_DLQ` (encaminhamento imediato para `wager-transactions-dlq.fifo`).

A publicação de eventos de integração (`OutboxPublisherWorker`, `APP_ROLE=outbox`) opera sobre `outbox_messages`
usando `FOR UPDATE SKIP LOCKED` e lease temporal (`locked_by`, `locked_until`), entregando envelopes
`IntegrationEvent<T>` em `wallet-events.fifo` com `MessageGroupId = aggregateId` e
`MessageDeduplicationId = eventId`. Transações `REFUND`/`ROLLBACK` entregues fora de ordem são reconciliadas pelo
`PendingReferenceWorker` (`APP_ROLE=scheduler`) com backoff exponencial até `PENDING_REF_MAX_ATTEMPTS`:

- [RFC-0006 — Consumidor SQS FIFO com Inbox persistente, classificação declarativa de falhas, DLQ e graceful shutdown](docs/rfc/RFC-0006-consumer-sqs-inbox-dlq-e-shutdown.md)
- [RFC-0007 — Transactional Outbox Publisher concorrente com lease e resolução assíncrona de referências pendentes](docs/rfc/RFC-0007-transactional-outbox-e-workers-assincronos.md)
- [ADR-0016 — Classificar falhas no consumer SQS com Inbox transacional, DLQ e graceful shutdown](docs/adr/0016-classificar-falhas-no-consumer-sqs-com-inbox-dlq-e-graceful-shutdown.md)
- [ADR-0017 — Publicar eventos da Transactional Outbox com `FOR UPDATE SKIP LOCKED` e lease temporal](docs/adr/0017-publicar-outbox-com-for-update-skip-locked-e-lease.md)
- [ADR-0018 — Resolver referências pendentes (`PENDING_REFERENCE`) com backoff exponencial e limite determinístico de tentativas](docs/adr/0018-resolver-referencias-pendentes-com-backoff-exponencial-e-ttl.md)

## 7. Taxonomia de falhas e mapeamento HTTP

Erros de domínio carregam `failureCode` estável (`FailureCode` enum) e são separados entre rejeições de negócio
auditáveis (persistidas como `status = 'REJECTED'` com evento `WagerTransactionRejected` na Outbox, retornando
HTTP `422` ou `200/201` com `idempotentReplay`) e erros de protocolo/conflito (HTTP `400`, `404`, `409`, `503`):

- [ADR-0013 — Definir taxonomia estável de `failureCode` e mapeamento declarativo para HTTP e SQS](docs/adr/0013-definir-taxonomia-de-failure-codes-e-mapeamento-http.md)
- [RFC-0005 — API HTTP REST, validação de contratos com Zod, filtro declarativo de erros e paginação por cursor](docs/rfc/RFC-0005-api-http-validacao-e-tratamento-de-erros.md)
- [ADR-0015 — Paginação do ledger por cursor opaco keyset (`created_at, id`)](docs/adr/0015-paginacao-do-ledger-por-cursor-opaco-keyset.md)

## 8. Observabilidade

A aplicação expõe métricas no formato Prometheus em `GET /metrics` via `MetricsPort` + `PrometheusMetricsAdapter`
(`prom-client`), cobrindo `wager_transactions_total`, `wager_idempotency_replays_total`, `wager_retries_total`,
`wager_dlq_messages_total`, `wager_lock_conflicts_total`, `wager_outbox_unpublished_count` (outbox lag),
`wallet_reconciliation_inconsistencies_total` e `wager_processing_duration_seconds`. Logs JSON estruturados
propagam `correlationId`, `messageId`, `transactionId`, `walletId` e `providerId` via `AsyncLocalStorage`
(`CorrelationContext`) e filtram recursivamente chaves financeiras (`money`, `balance`, `amount`,
`initialBalance`):

- [RFC-0008 — Observabilidade com métricas Prometheus (`/metrics`), logs JSON estruturados e health checks](docs/rfc/RFC-0008-observabilidade-metricas-logs-e-health.md)
- [ADR-0019 — Expor métricas Prometheus (`prom-client`) via `MetricsPort` e sanitizar payloads financeiros nos logs](docs/adr/0019-expor-metricas-prometheus-e-logs-estruturados-sem-dados-sensiveis.md)

## 9. Autenticação e Infraestrutura Escalável (Terraform & Auto Scaling)

### 9.1 Ponto de Extensão de Autenticação (`ProviderIdentityPort` + `ProviderAuthGuard`)

No código (`src/application/ports/provider-identity.port.ts` e `src/interfaces/http/guards/provider-auth.guard.ts`),
toda requisição HTTP (exceto `/health/*` e `/metrics`) passa pelo `ProviderAuthGuard`, que delega a resolução de
identidade para `ProviderIdentityPort`. Localmente é usado `NoopProviderIdentityAdapter`; em produção, o
adaptador OIDC/Keycloak valida tokens JWT `RS256` emitidos via `client_credentials` grant contra o endpoint JWKS
do Keycloak (`iss`, `aud`, `exp`, claim `provider_id` e scopes `wagering:write` / `wagering:read`).

### 9.2 Infraestrutura como Código (`infra/terraform/`), EKS, Helm e Auto Scaling por `APP_ROLE`

Toda a infraestrutura AWS está declarada em [`infra/terraform/`](infra/terraform/versions.tf), com imagens gerenciadas no **Amazon ECR** e orquestração moderna e cloud-agnostic via **Amazon EKS (Kubernetes 1.31) e Helm**:

- **Rede (`infra/terraform/network.tf`)**: VPC multi-AZ com sub-redes públicas (ALB/Ingress) e privadas (EKS Pods, RDS Proxy, RDS PostgreSQL 17).
- **Registro de Contêineres (`infra/terraform/ecr.tf`)**: Repositório Amazon ECR com tag immutability, criptografia KMS e scan automático de vulnerabilidades no push via Trivy no CI/CD.
- **Persistência (`infra/terraform/rds.tf`)**: RDS PostgreSQL 17 Multi-AZ protegido por **RDS Proxy** (multiplexação de conexões para absorver o *scale-out* de dezenas de Pods sem esgotar `max_connections`).
- **Mensageria (`infra/terraform/sqs.tf`)**: `wager-transactions.fifo`, `wager-transactions-dlq.fifo` (RedrivePolicy `maxReceiveCount = 5`) e `wallet-events.fifo` com `deduplication_scope = "messageGroup"` e `fifo_throughput_limit = "perMessageGroupId"` (*High Throughput FIFO*).
- **Orquestração Cloud-Native via Amazon EKS + Helm Chart (`infra/terraform/eks.tf`, `infra/terraform/helm_app.tf`, `infra/helm/distributed-wagering-processor/`)**:
  - Cluster EKS Kubernetes 1.31 com Managed Node Groups e criptografia de Secrets em repouso via AWS KMS CMK.
  - O Terraform (`helm_app.tf`) implanta automaticamente o **Helm Chart** nos nós do EKS:
    - `deployment-api.yaml`: réplicas gerenciadas pelo **HorizontalPodAutoscaler (HPA)** por CPU (> 65%) e Memória (> 75%), variando de 2 a 20 Pods.
    - `deployment-consumer.yaml`: réplicas gerenciadas por **KEDA (`ScaledObject`)** que escala Pods dinamicamente de 2 até 30 baseado no tamanho da fila SQS (`queueLength: 50`).
    - `deployment-workers.yaml`: Pods de outbox publisher e scheduler worker com concorrência segura (`SKIP LOCKED`).
    - `serviceaccount.yaml`: integração granular com **IAM Roles for Service Accounts (IRSA)** para garantir o Princípio do Menor Privilégio por Pod.
  - **Flexibilidade Futura no Kubernetes (CronJobs)**:
    - O ambiente EKS permite o melhor dos dois mundos: serviços orientados a eventos (HTTP/SQS) convivendo harmoniosamente com `CronJob`s agendados nativos do Kubernetes para processos periódicos de consolidação contábil, auditoria fria de integridade wallet/ledger e fechamento de relatórios financeiros sem necessidade de tarefas ECS adicionais ou regras no EventBridge.

Decisão documentada em:
- [ADR-0020 — Ponto de extensão de autenticação (`ProviderIdentityPort` + `ProviderAuthGuard`) e infraestrutura escalável com Terraform e Auto Scaling](docs/adr/0020-ponto-de-extensao-auth-oidc-e-infraestrutura-terraform-autoscaling.md)

## 10. Suíte de Concorrência Multi-Instância e Verificação dos 8 Cenários

A suíte consolidada em `test/concurrency/mandatory-8-scenarios.spec.ts` exercita os **8 cenários obrigatórios da Seção 13** do desafio utilizando **3 nós NestJS simultâneos** (`instance-1`, `instance-2`, `instance-3`) conectados à infraestrutura real de PostgreSQL 17 e MiniStack SQS:

1. **Cenário 1 e 4**: Mesma aposta enviada 50 vezes em paralelo distribuída entre as 3 instâncias -> exatamente 1 débito efetuado (HTTP 201), 1 entrada no razão, 49 replays idempotentes (HTTP 200) e balance/version consistentes.
2. **Cenário 2**: Concorrência feroz disputando saldo em *hot wallet* (duas apostas de 80.00 disputando saldo de 100.00 -> 1 processada e 1 rejeitada por `INSUFFICIENT_FUNDS`; burst de 20 apostas de 10.00 -> exatamente 10 aceitas e 10 rejeitadas, saldo final 0.00).
3. **Cenário 3**: 15 carteiras distintas processadas em paralelo sem lock global nem bloqueio mútuo, confirmando que a contenção é restrita à granularidade da linha da carteira.
4. **Cenários 5, 6 e 7**: Crash de worker após commit antes do ACK do SQS (redelivery processada via Inbox com deduplicação persistente); múltiplos publishers de Outbox disputando mensagens concorrentemente via `FOR UPDATE SKIP LOCKED`; e transação `ROLLBACK`/`REFUND` entregue antes do `BET` correspondente (colocada em `PENDING_REFERENCE` e resolvida pelo `PendingReferenceWorker`).
5. **Cenário 8**: Reinício de serviço durante trabalho pendente na fila SQS, com recuperação pelo novo nó e verificação formal da invariante contábil: `wallet.balance == sum(ledger)`.

- [RFC-0009 — Suíte completa de concorrência multi-instância (8 cenários da Seção 13) e benchmark de carga](docs/rfc/RFC-0009-suite-concorrencia-multi-instancia-e-teste-de-carga.md)
- [ADR-0021 — Testar concorrência, recuperação pós-crash e out-of-order com múltiplas instâncias simultâneas e infraestrutura real](docs/adr/0021-testar-concorrencia-e-recuperacao-com-multiplas-instancias-e-infra-real.md)

## 11. Benchmark de Carga Reproduzível (`bun run test:load`)

O script [`src/interfaces/cli/load-test.ts`](src/interfaces/cli/load-test.ts) implementa um teste de estresse autônomo com cálculo de percentis de latência ($p50$, $p95$, $p99$, $max$) e verificação formal pós-execução de conciliação contábil:

- **Cenário executado**: 300 requisições HTTP concorrentes com concorrência 25, misturando 20 carteiras distribuídas, *hot wallet* sob alta contenção e injeção de tentativas de replay idempotente.
- **Resultados obtidos**:
  - **Throughput**: ~650 RPS (execução completa em 0.46s).
  - **Latências**: $p50 \approx 18.45\text{ ms}$, $p95 \approx 57.84\text{ ms}$, $p99 \approx 104.58\text{ ms}$, $\max \approx 122.58\text{ ms}$.
  - **Resultados HTTP**: 270 transações processadas (201), 15 replays idempotentes (200), 0 rejeições indevidas, **zero erros 5xx**.
  - **Drenagem de Outbox**: 560 eventos criados na outbox transacional, drenados para o SQS em ~626 ms com lag final 0.
  - **Conciliação financeira**: 20 de 20 carteiras (100%) consistentes (`balance == sum(ledger)`).

## 12. Interpretações adotadas

| Regra do desafio | Interpretação | ADR |
|---|---|---|
| 7.4 — reversão única "pelo mesmo tipo" | No máximo **uma reversão efetiva** (REFUND ou ROLLBACK) por transação referenciada, evitando crédito duplo | [ADR-0009](docs/adr/0009-garantir-invariantes-financeiras-no-schema-postgres.md) / [ADR-0014](docs/adr/0014-aplicar-politica-de-reversao-unica-e-validacao-de-referencia.md) |
| 6.1 — escala fixa de 2 casas | Entrada aceita 0–2 casas e é normalizada para 2; saída sempre com 2 | [ADR-0007](docs/adr/0007-representar-money-com-bigint-no-dominio-e-numeric-no-banco.md) |

## 13. Trade-offs e limitações

1. **Lock pessimista por carteira vs. Concorrência Otimista (OCC)**:
   - *Decisão*: Lock pessimista (`SELECT ... FOR UPDATE` com timeout na carteira).
   - *Trade-off*: Em *hot wallets* que recebem centenas de requisições por segundo simultâneas, as requisições são serializadas na fila de lock do PostgreSQL. Sob OCC com retry, haveria alto desperdício de CPU por aborts e retries contínuos. A abordagem pessimista garante latência estável e zero mutação fantasma.
2. **SQS FIFO vs. Apache Kafka**:
   - *Decisão*: Amazon SQS FIFO com `MessageGroupId = walletId`.
   - *Trade-off*: SQS FIFO oferece granularidade de chave de partição dinâmica ilimitada (cada `walletId` é seu próprio grupo sequencial independente), sem necessidade de dimensionamento estático de tópicos/partições. A limitação é o throughput de 300 msg/s por grupo de mensagens (ou até 3.000 msg/s no modo High Throughput FIFO), o que é mais do que suficiente para o tráfego de uma única carteira.
3. **Transactional Outbox via Polling + `SKIP LOCKED` vs. CDC (Debezium/Kafka Connect)**:
   - *Decisão*: Polling concorrente com `FOR UPDATE SKIP LOCKED` e lease temporal.
   - *Trade-off*: Elimina a complexidade operacional e a dependência de infraestrutura externa pesada (Kafka, Kafka Connect, Debezium, engine de replicação lógica). O trade-off é uma latência adicional média de publicação proporcional ao intervalo de poll (`OUTBOX_POLL_INTERVAL_MS=500ms`).
4. **Monólito Modular Parametrizado (`APP_ROLE`) vs. Microsserviços Distribuídos**:
   - *Decisão*: Repositório único e imagem Docker única, executável em diferentes perfis (`api`, `consumer`, `outbox`, `scheduler` ou `all`).
   - *Trade-off*: Elimina o overhead de comunicação inter-serviços via RPC, múltiplos pipelines de CI/CD e proliferação de repositórios, permitindo escalar serviços de forma independente como Pods no Amazon EKS com baixo custo de manutenção.
5. **Defesa em Profundidade OWASP e Rate Limiting (Sliding Window)**:
   - *Decisão*: Rate limiting contextual por Provedor e rota na aplicação via `RateLimitGuard` + `SecurityHeadersMiddleware` (HSTS, CSP, etc.) + rate limit no Ingress.
   - *Trade-off*: A janela deslizante em memória opera por réplica de pod, protegendo o banco contra ataques volumétricos com zero latência de rede adicional (sem exigir Redis externo), com interface preparada para adapter distribuído se necessário. Documentado em [ADR-0022](docs/adr/0022-mitigacao-owasp-api-security-e-rate-limiting.md).

## 14. Documentação Dual de API (ReDoc & Swagger) e Governança com Skill `document-api`

A plataforma implementa uma separação arquitetural explícita entre documentação externa (parceiros) e console operacional interno:
1. **Pública (`/v1/api/docs` — ReDoc 3-Column Reference)**:
   - Visão estritamente **black-box** com aplicação rígida do princípio de **Information Hiding**.
   - Diagramas de sequência orientados ao protocolo de negócio (`[Game Provider / Partner] <---> [Wagering API Gateway] <---> [Core Financial Engine]`).
   - Oculta completamente detalhes de banco de dados (`SELECT ... FOR UPDATE`, queries SQL, nomes de tabelas/colunas internas como `wager_tx` ou `wallet_ledger_entries`) e mecânicas assíncronas de workers (`SKIP LOCKED`).
   - Exemplos exaustivos mapeando todos os status de sucesso e erro (`200`, `201`, `202`, `400`, `404`, `409`, `422`, `429`, `503`).
2. **Privada & Operacional (`/v1/api/docs/swagger` — Swagger UI Interactive Console)**:
   - Visão **white-box** para SREs, auditores contábeis e avaliadores técnicos.
   - Sem ocultação de mecanismos internos: detalha locks de concorrência, transações atômicas, transactional outbox com leases e comandos operacionais (`/wallets/:id/reconcile`, `/health/live`, `/health/ready`, `/metrics`).
3. **Skill Padronizadora (`.agents/skills/document-api/SKILL.md`)**:
   - Garante que qualquer funcionalidade nova ou alterada respeite essa segregação, mantenha diagramas monospaçados Unicode sem scripts externos pesados e preserve a regra de zero comentários em arquivos `.ts`.

Documentado em:
- [RFC-0010 — Padronização de Rotas `/api/v1`, `/v1/api` e Documentação Dual ReDoc & Swagger UI](docs/rfc/RFC-0010-padronizacao-rotas-api-v1-e-documentacao-dual-redoc-swagger.md)
- [RFC-0011 — Diagramas de Fluxo e Sequência na Documentação OpenAPI](docs/rfc/RFC-0011-diagramas-de-fluxo-na-documentacao-openapi.md)
- [ADR-0023 — Adotar Prefixo `/api/v1` e `/v1/api` com Compatibilidade Dual e Documentação ReDoc e Swagger](docs/adr/0023-adotar-prefixo-api-v1-e-documentacao-dual-redoc-swagger.md)
- [ADR-0024 — Incluir Diagramas de Fluxo e Sequência na Documentação OpenAPI](docs/adr/0024-incluir-diagramas-de-fluxo-na-documentacao-openapi.md)
- [ADR-0025 — Auto-Merge Seguro do Dependabot para Atualizações de Dependências sem Impacto em Fluxos de Negócio](docs/adr/0025-auto-merge-dependabot-para-atualizacoes-seguras-sem-impacto-em-fluxo.md)

## 15. Trilha de Auditoria Fiscalizatória em Parquet/Athena e Observabilidade OpenTelemetry/Datadog

Para conformidade regulatória fiscalizatória (compliance de apostas e auditoria contábil externa) sem degradar o banco transacional PostgreSQL OLTP:

1. **Trilha de Auditoria em Runtime (`AuditLoggingMiddleware` + `InMemoryRingBufferAuditTrailAdapter` + `AdminAuditController`)**:
   - Cada requisição é capturada com atributos de conformidade: `providerId`, `clientId`, `clientIp` (com parsing seguro de proxies via `x-forwarded-for`), método, rota, status code, latência em ms, `correlationId`, `traceId`, `spanId` e `userAgent`.
   - Consulta fiscalizatória em tempo real via endpoint administrativo protegido `GET /api/v1/admin/audit`, com suporte a filtros combinados (`providerId`, `walletId`, `clientIp`, `statusCode`, `since`, `limit`).
2. **Armazenamento Frio em Formato Colunar Parquet e Consultas SQL no AWS Athena (`infra/terraform/audit.tf`)**:
   - Infraestrutura como Código provisiona bucket S3 corporativo (`distributed-wagering-audit-trail-<env>`) com ciclo de vida (transição para Glacier após 90 dias e expiração em 5 anos).
   - Catálogo AWS Glue e tabela externa particionada por `year/month/day`, permitindo auditorias fiscais com consultas SQL ANSI serverless via Amazon Athena com escaneamento mínimo de bytes e custo reduzido.
3. **Observabilidade Unificada com OpenTelemetry e Datadog APM**:
   - Interceptor W3C Trace Context (`CorrelationIdInterceptor`) que processa e propaga cabeçalhos `traceparent` (`00-<traceId>-<spanId>-<traceFlags>`).
   - Mapeamento determinístico entre identificadores W3C (128-bit trace ID e 64-bit span ID) e logs estruturados em JSON, permitindo correlação automática bi-direcional nos consoles do Datadog APM e CloudWatch.

Documentado em:
- [RFC-0012 — Trilha de Auditoria Fiscalizatória em Parquet/Athena e Observabilidade Unificada com OpenTelemetry e Datadog](docs/rfc/RFC-0012-trilha-de-auditoria-fiscalizatoria-e-observabilidade-opentelemetry-datadog.md)
- [ADR-0026 — Trilha de Auditoria Fiscalizatória de Acessos via S3 Parquet, Athena e Endpoint Administrativo](docs/adr/0026-trilha-de-auditoria-fiscalizatoria-via-s3-parquet-athena-e-endpoint-administrativo.md)
- [ADR-0027 — Observabilidade e Tracing Distribuído com Padrão OpenTelemetry e Datadog APM](docs/adr/0027-observabilidade-e-tracing-distribuido-com-opentelemetry-e-datadog.md)

