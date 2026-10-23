# Roadmap — Distributed Wagering Processor

Plano de execução por fases. Cada fase segue o ciclo **RFC → ADRs → implementação → testes → docs** e só
termina quando o critério de pronto for verificado. Processo descrito em
[ADR-0001](adr/0001-registrar-decisoes-arquiteturais.md).

Legenda: ⬜ não iniciado · 🟨 em andamento · ✅ concluído

## Decisões já tomadas (pré-RFC)

| # | Tema | Decisão | ADR |
|---|---|---|---|
| D1 | Autenticação | `AuthGuard` no-op + `ProviderIdentityPort`; desenho com Keycloak (OIDC `client_credentials`) apenas documentado | [0020](adr/0020-ponto-de-extensao-auth-oidc-e-infraestrutura-terraform-autoscaling.md) |
| D2 | Reversões | No máximo **uma reversão efetiva** (REFUND **ou** ROLLBACK) por transação referenciada, evitando crédito duplo. Interpretação mais estrita que a regra 7.4 | [0009](adr/0009-garantir-invariantes-financeiras-no-schema-postgres.md) / 0014 |
| D3 | Entrada de `amount` | Aceitar 0–2 casas decimais (`"25"`, `"25.5"`) e normalizar para `"25.00"`; o hash usa o valor normalizado. Rejeitar >2 casas, sinal, notação científica, zeros à esquerda, vazio | [0007](adr/0007-representar-money-com-bigint-no-dominio-e-numeric-no-banco.md) |
| D4 | Idioma | Código e identificadores em inglês; documentação em PT-BR | [0001](adr/0001-registrar-decisoes-arquiteturais.md) |
| D5 | Customizações do agente | `AGENTS.md` + skills em `.agents/skills/` (`write-adr`, `write-rfc`, `db-migration`) | — |

## Fases

| Fase | Status | Tema | RFC | ADRs | Critério de pronto |
|---|---|---|---|---|---|
| 0 | ✅ | Fundação de documentação | — | [0001](adr/0001-registrar-decisoes-arquiteturais.md) | Estrutura `docs/`, templates, `AGENTS.md`, skills, enunciado movido |
| 1 | ✅ | **Stack, scaffolding e topologia** | [RFC-0001](rfc/RFC-0001-stack-scaffolding-e-topologia.md) | [0002](adr/0002-adotar-stack-base-bun-typescript-nestjs-postgres.md) · [0003](adr/0003-usar-mikroorm-com-entity-schema-sem-decorators-no-dominio.md) · [0004](adr/0004-gerar-identificadores-com-uuidv7-na-aplicacao.md) · [0005](adr/0005-adotar-ministack-como-emulador-sqs-padrao.md) · [0006](adr/0006-estruturar-topologia-em-modular-monolith-por-papeis.md) | Spike Bun + Nest + MikroORM + pg ok; `docker compose up` sobe pg + MiniStack + app; `bun test` verde; lint/typecheck no CI local |
| 2 | ✅ | **Modelagem de dados e relacionamentos** | [RFC-0002](rfc/RFC-0002-modelagem-de-dados-e-relacionamentos.md) | [0007](adr/0007-representar-money-com-bigint-no-dominio-e-numeric-no-banco.md) · [0008](adr/0008-modelar-enums-no-postgres-com-text-e-check-constraints.md) · [0009](adr/0009-garantir-invariantes-financeiras-no-schema-postgres.md) | Migrations `up → down → up` limpas; **cada constraint tem um teste** de integração que prova a rejeição |
| 3 | ✅ | Modelo de domínio | [RFC-0003](rfc/RFC-0003-modelo-de-dominio-e-maquina-de-estados.md) | [0010](adr/0010-maquina-de-estados-e-politicas-declarativas-no-dominio.md) | Testes de unidade: `Money`, `Wallet`, regras BET/WIN/LOSS/REFUND/ROLLBACK, conflito de moeda |
| 4 | ✅ | Pipeline de processamento: concorrência e idempotência | [RFC-0004](rfc/RFC-0004-pipeline-de-processamento-concorrencia-e-idempotencia.md) | [0011](adr/0011-usar-lock-pessimista-por-wallet-com-defesa-em-profundidade.md) · [0012](adr/0012-garantir-idempotencia-persistente-e-hash-canonico-sha256.md) · [0013](adr/0013-definir-taxonomia-de-failure-codes-e-mapeamento-http.md) · [0014](adr/0014-aplicar-politica-de-reversao-unica-e-validacao-de-referencia.md) | Cenário 100/80/80; 50× a mesma aposta em paralelo → 1 débito; conflito de payload → 409 |
| 5 | ✅ | API HTTP | [RFC-0005](rfc/RFC-0005-api-http-validacao-e-tratamento-de-erros.md) | [0015](adr/0015-paginacao-do-ledger-por-cursor-opaco-keyset.md) | Endpoints da seção 9, reconciliação, health; testes e2e |
| 6 | ✅ | Consumer SQS + Inbox | [RFC-0006](rfc/RFC-0006-consumer-sqs-inbox-dlq-e-shutdown.md) | [0016](adr/0016-classificar-falhas-no-consumer-sqs-com-inbox-dlq-e-graceful-shutdown.md) | Redelivery sem duplicar; DLQ após N tentativas; kill após commit e antes do ack; SIGTERM |
| 7 | ✅ | Transactional Outbox + eventos | [RFC-0007](rfc/RFC-0007-transactional-outbox-e-workers-assincronos.md) | [0017](adr/0017-publicar-outbox-com-for-update-skip-locked-e-lease.md) | 2+ publishers sem perda; crash entre commit e publish recuperado; duplicata segura |
| 8 | ✅ | Referências fora de ordem | [RFC-0007](rfc/RFC-0007-transactional-outbox-e-workers-assincronos.md) | [0018](adr/0018-resolver-referencias-pendentes-com-backoff-exponencial-e-ttl.md) | ROLLBACK antes da BET → processado após chegada; expirado → `REJECTED` + evento |
| 9 | ✅ | Observabilidade | [RFC-0008](rfc/RFC-0008-observabilidade-metricas-logs-e-health.md) | [0019](adr/0019-expor-metricas-prometheus-e-logs-estruturados-sem-dados-sensiveis.md) | Métricas da seção 12 expostas e cobertas por teste; logs sem payload financeiro |
| 10 | ✅ | Autenticação (ponto de extensão) & Terraform Auto-Scaling | — | [0020](adr/0020-ponto-de-extensao-auth-oidc-e-infraestrutura-terraform-autoscaling.md) | Guard + port no código; desenho Keycloak no `ARCHITECTURE.md`; IaC Terraform (`infra/terraform/`) com Auto Scaling por `APP_ROLE` |
| 11 | ✅ | Hardening de testes | [RFC-0009](rfc/RFC-0009-suite-concorrencia-multi-instancia-e-teste-de-carga.md) | [0021](adr/0021-testar-concorrencia-e-recuperacao-com-multiplas-instancias-e-infra-real.md) | Os 8 cenários de concorrência da seção 13 verdes com ≥3 instâncias simultâneas e PostgreSQL/SQS reais; invariante `balance == ledger` em todos; script reproduzível de carga |
| 12 | ✅ | Documentação final | — | — | `README.md` com setup/comandos e exemplos curl; `ARCHITECTURE.md` com decisões, trade-offs, limitações e benchmark de carga; IaC Terraform completa |
| 13 | ✅ | **Padrão de Rotas `/api/v1` & Documentação Dual ReDoc/Swagger** | [RFC-0010](rfc/RFC-0010-padronizacao-rotas-api-v1-e-documentacao-dual-redoc-swagger.md) | [0022](adr/0022-mitigacao-owasp-api-security-e-rate-limiting.md) · [0023](adr/0023-adotar-prefixo-api-v1-e-documentacao-dual-redoc-swagger.md) | Rotas versionadas sob `/api/v1` com rewrite de compatibilidade reversa para rotas legadas; ReDoc padrão Zé Delivery (`GET /docs`) e Swagger UI interativo (`GET /docs/swagger`); zero HTML manual em controllers; CSP adaptado |
| 14 | ✅ | **Diagramas de Fluxo OpenAPI & Auto-Merge Seguro do Dependabot** | [RFC-0011](rfc/RFC-0011-diagramas-de-fluxo-na-documentacao-openapi.md) | [0024](adr/0024-incluir-diagramas-de-fluxo-na-documentacao-openapi.md) · [0025](adr/0025-auto-merge-dependabot-para-atualizacoes-seguras-sem-impacto-em-fluxo.md) | Diagramas de sequência e pipelines de execução ACID integrados no ReDoc e Swagger UI; skill document-api criada; auto-merge seguro do Dependabot ativo para updates que não alteram fluxos |

## Mapa requisito → fase

| Seção do desafio | Pontos | Fases |
|---|---|---|
| Correção financeira | 20 | 2, 3, 4, 5 |
| Concorrência | 20 | 2, 4, 11 |
| Idempotência | 15 | 2, 4, 6 |
| Mensageria e falhas | 15 | 6, 7, 8 |
| Modelagem e arquitetura | 10 | 1, 2, 3 |
| Testes | 10 | todas, consolidado na 11 |
| Observabilidade | 5 | 9 |
| Documentação | 5 | 0, 12 (contínuo) |
