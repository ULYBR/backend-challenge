# Architecture Decision Records

Formato: [MADR](https://adr.github.io/madr/) — template em [0000-template.md](0000-template.md).
Processo: [ADR-0001](0001-registrar-decisoes-arquiteturais.md).

| ADR | Título | Status | Fase |
|---|---|---|---|
| [0001](0001-registrar-decisoes-arquiteturais.md) | Registrar decisões arquiteturais com ADRs (MADR) e desenhos com RFCs | Accepted | 0 |
| [0002](0002-adotar-stack-base-bun-typescript-nestjs-postgres.md) | Adotar a stack base Bun 1.x, TypeScript strict, NestJS 11, PostgreSQL 17, Zod e Biome | Accepted | 1 |
| [0003](0003-usar-mikroorm-com-entity-schema-sem-decorators-no-dominio.md) | Usar MikroORM v6 com EntitySchema e mappers explícitos sem decorators no domínio | Accepted | 1 |
| [0004](0004-gerar-identificadores-com-uuidv7-na-aplicacao.md) | Gerar identificadores internos com UUIDv7 na aplicação | Accepted | 1 |
| [0005](0005-adotar-ministack-como-emulador-sqs-padrao.md) | Adotar MiniStack como emulador SQS padrão no Docker Compose mantendo compatibilidade com LocalStack | Accepted | 1 |
| [0006](0006-estruturar-topologia-em-modular-monolith-por-papeis.md) | Estruturar a aplicação como monólito modular parametrizado por papéis (APP_ROLE) | Accepted | 1 |
| [0007](0007-representar-money-com-bigint-no-dominio-e-numeric-no-banco.md) | Representar Money com bigint em unidades menores no domínio e NUMERIC(19,2) no PostgreSQL | Accepted | 2 |
| [0008](0008-modelar-enums-no-postgres-com-text-e-check-constraints.md) | Modelar enums no PostgreSQL com colunas TEXT e CHECK constraints | Accepted | 2 |
| [0009](0009-garantir-invariantes-financeiras-no-schema-postgres.md) | Garantir invariantes financeiras no schema PostgreSQL combinando FKs compostas, partial unique indexes e triggers | Accepted | 2 |
| [0010](0010-maquina-de-estados-e-politicas-declarativas-no-dominio.md) | Expressar a máquina de estados e as regras por tipo de transação com mapas declarativos em vez de condicionais | Accepted | 3 |
| [0011](0011-usar-lock-pessimista-por-wallet-com-defesa-em-profundidade.md) | Usar lock pessimista por carteira (`SELECT ... FOR UPDATE`) combinado com versão e invariantes de schema | Accepted | 4 |
| [0012](0012-garantir-idempotencia-persistente-e-hash-canonico-sha256.md) | Garantir idempotência persistente por `(provider_id, external_transaction_id)` e `payload_hash` SHA-256 canônico | Accepted | 4 |
| [0013](0013-definir-taxonomia-de-failure-codes-e-mapeamento-http.md) | Definir taxonomia estável de `failureCode` e mapeamento declarativo para HTTP e SQS | Accepted | 4 |
| [0014](0014-aplicar-politica-de-reversao-unica-e-validacao-de-referencia.md) | Aplicar política de reversão única por transação referenciada e validação estrita de `referenceTransactionId` | Accepted | 4 |
| [0015](0015-paginacao-do-ledger-por-cursor-opaco-keyset.md) | Paginação do ledger por cursor opaco keyset (`created_at, id`) | Accepted | 5 |
| [0016](0016-classificar-falhas-no-consumer-sqs-com-inbox-dlq-e-graceful-shutdown.md) | Classificar falhas no consumer SQS com Inbox transacional, DLQ e graceful shutdown | Accepted | 6 |
| [0017](0017-publicar-outbox-com-for-update-skip-locked-e-lease.md) | Publicar eventos da Transactional Outbox com `FOR UPDATE SKIP LOCKED` e lease temporal | Accepted | 7 |
| [0018](0018-resolver-referencias-pendentes-com-backoff-exponencial-e-ttl.md) | Resolver referências pendentes (`PENDING_REFERENCE`) com backoff exponencial e limite determinístico de tentativas | Accepted | 8 |
| [0019](0019-expor-metricas-prometheus-e-logs-estruturados-sem-dados-sensiveis.md) | Expor métricas Prometheus (`prom-client`) via `MetricsPort` e sanitizar payloads financeiros nos logs | Accepted | 9 |
| [0020](0020-ponto-de-extensao-auth-oidc-e-infraestrutura-terraform-autoscaling.md) | Ponto de extensão de autenticação (`ProviderIdentityPort` + `ProviderAuthGuard`) e infraestrutura escalável com Terraform e Auto Scaling | Accepted | 10 |
| [0021](0021-testar-concorrencia-e-recuperacao-com-multiplas-instancias-e-infra-real.md) | Testar concorrência e recuperação com múltiplas instâncias reais da aplicação sobre PostgreSQL e SQS em containers | Accepted | 11 |
| [0022](0022-mitigacao-owasp-api-security-e-rate-limiting.md) | Mitigação de vulnerabilidades OWASP API Security Top 10 e Rate Limiting defensivo com Sliding Window | Accepted | 10 |
| [0023](0023-adotar-prefixo-api-v1-e-documentacao-dual-redoc-swagger.md) | Adotar prefixo /api/v1 com compatibilidade reversa e documentação dual ReDoc e Swagger UI | Accepted | 10 |

