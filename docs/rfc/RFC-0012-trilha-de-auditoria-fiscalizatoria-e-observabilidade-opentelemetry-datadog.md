---
rfc: RFC-0012
title: Trilha de Auditoria Fiscalizatória em Parquet/Athena e Observabilidade Unificada com OpenTelemetry e Datadog
status: Implemented # Draft -> Accepted -> Implemented
author: Time de Engenharia
created: 2026-10-23
updated: 2026-10-23
phase: 15 # fase do docs/ROADMAP.md
adrs:
  - docs/adr/0026-trilha-de-auditoria-fiscalizatoria-via-s3-parquet-athena-e-endpoint-administrativo.md
  - docs/adr/0027-observabilidade-e-tracing-distribuido-com-opentelemetry-e-datadog.md
---

# RFC-0012 — Trilha de Auditoria Fiscalizatória em Parquet/Athena e Observabilidade Unificada com OpenTelemetry e Datadog

## 1. Resumo

Este RFC define a arquitetura para atender a dois pilares essenciais de segurança e operações:
1. **Trilha de Auditoria Fiscalizatória de Acessos**: Rastreabilidade completa de **quem** usou a aplicação (`providerId`, `clientId`, token/principal, `clientIp`, `userAgent`), **o que** fez (rota, método, `correlationId`, status code, latência) e **como fiscalizar** essa informação (via endpoint administrativo de auditoria em runtime e via consultas SQL serverless no **AWS Athena** sobre arquivos colunares **Apache Parquet no Amazon S3**, sem degradar a performance do banco transacional PostgreSQL).
2. **Monitoramento Unificado com OpenTelemetry e Datadog**: Padronização de observabilidade sob o padrão CNCF **OpenTelemetry (OTel)** integrado ao **Datadog APM**, correlacionando traces distribuídos W3C (`traceId`, `spanId`) com os logs estruturados de auditoria e métricas de desempenho.

---

## 2. Contexto e motivação

- **Regulamentação e Fiscalização (SPA/MF, PCI-DSS e LGPD)**: Plataformas financeiras e de apostas exigem trilhas de auditoria imutáveis para responder a exigências de conformidade regulatória: *"Qual IP requisitou o débito da carteira X?", "Quantas tentativas com status 422/429 partiram do provedor Y entre 18:00 e 19:00?"*.
- **Prevenção de Degradação do Banco de Dados OLTP**: Gravar cada evento de acesso HTTP diretamente no PostgreSQL disputa IOPS, pool de conexões e locks com a máquina transacional de apostas. É imperativo adotar um pipeline desacoplado que descarregue os eventos em lote colunar compactado (**Apache Parquet no S3**).
- **Necessidade de Fiscalização Acessível**: Ter os dados no S3 em formato bruto não resolve se a equipe de auditoria ou SRE não conseguir consultar. É obrigatório fornecer tanto um **endpoint de fiscalização administrativa na API** (com filtros por IP, provedor, carteira e período) quanto a infraestrutura de consulta SQL via **AWS Athena**.
- **Observabilidade Moderna**: A plataforma já possui métricas Prometheus (`/metrics`) e logs Pino estruturados, mas carece de rastreamento distribuído fim-a-fim entre a API, workers SQS e transações de banco com suporte ao ecossistema OpenTelemetry/Datadog.

---

## 3. Objetivos e não-objetivos

### Objetivos:
1. **Captura Segura e Completa de Acesso**: Middleware de auditoria que extrai o IP real do cliente (`x-forwarded-for` sanitizado), identidade do provedor (`providerId`), método HTTP, rota, código de status, duração em milissegundos e `correlationId`.
2. **Endpoint de Fiscalização Administrativa**: Expor `GET /api/v1/wallets/{id}/audit` e `GET /api/v1/admin/audit` no Swagger UI operacional para consultas imediatas em runtime.
3. **Data Lake de Auditoria em Parquet + Athena**: Especificação em Terraform (`infra/terraform/audit.tf`) de bucket S3 com retenção, Kinesis Data Firehose para conversão contínua em Apache Parquet e catálogo de tabelas AWS Athena com queries prontas de fiscalização.
4. **Tracing Distribuído OpenTelemetry & Datadog**: Propagação de contexto W3C TraceContext (`traceparent`, `tracestate`) correlacionando spans de APM com os logs de auditoria (`dd.trace_id`, `dd.span_id`).

### Não-objetivos:
- Gravar eventos de auditoria de acessos em tabelas transacionais do PostgreSQL principal.
- Expor dados brutos de cartões, senhas ou tokens secretos nos logs ou na trilha de auditoria.
- Substituir a idempotência transacional ou o ledger imutável (que permanecem no PostgreSQL).

---

## 4. Desenho proposto

### 4.1 Arquitetura em Três Camadas (Ingestão, Armazenamento e Fiscalização)

```
[Game Provider / Cliente]
          │
          ▼ (HTTP Request com traceparent)
┌────────────────────────────────────────────────────────┐
│  API Gateway (NestJS)                                  │
│  ├── ProviderAuthGuard (identifica o ator)             │
│  ├── OpenTelemetryTracingMiddleware (inicia span raiz) │
│  └── AuditLoggingMiddleware                            │
│      ├── Alimenta Ring Buffer de Fiscalização Imediata │
│      └── Emite log estruturado JSON em stdout          │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ├────────────────────────────────────────┐
                           ▼                                        ▼
             ┌───────────────────────────┐            ┌───────────────────────────┐
             │ Consulta em Runtime       │            │ Pipeline Assíncrono       │
             │ GET /admin/audit          │            │ (Kinesis Data Firehose)   │
             │ • Filtro por IP           │            │ • Micro-batching          │
             │ • Filtro por Provider     │            │ • Conversão para Parquet  │
             │ • Filtro por Carteira     │            └─────────────┬─────────────┘
             └───────────────────────────┘                          │
                                                                    ▼
                                                      ┌───────────────────────────┐
                                                      │ Amazon S3 Bucket          │
                                                      │ s3://audit-logs/year=...  │
                                                      └─────────────┬─────────────┘
                                                                    │
                                                                    ▼
                                                      ┌───────────────────────────┐
                                                      │ AWS Athena & Datadog SIEM │
                                                      │ SQL: SELECT * FROM audit  │
                                                      └───────────────────────────┘
```

### 4.2 Contratos e Schemas de Auditoria

#### Evento de Auditoria de Acesso (`SecurityAuditAccessEventDto`):
```typescript
export interface SecurityAuditAccessEventDto {
  readonly id: string; // UUIDv7 do evento de auditoria
  readonly timestamp: string; // ISO 8601 UTC
  readonly clientIp: string; // IP real do requisitante
  readonly providerId: string | null; // Provedor autenticado
  readonly method: "GET" | "POST" | "PUT" | "DELETE";
  readonly path: string; // Ex: /api/v1/wagering/transactions
  readonly statusCode: number; // Ex: 201, 200, 422, 429
  readonly durationMs: number; // Tempo de resposta em ms
  readonly correlationId: string; // ID de correlação
  readonly traceId?: string; // OTel / Datadog Trace ID
  readonly spanId?: string; // OTel / Datadog Span ID
  readonly userAgent: string; // User-Agent do cliente
  readonly failureCode?: string; // Ex: INSUFFICIENT_FUNDS
  readonly walletId?: string; // Carteira afetada
}
```

---

## 5. Invariantes e garantias

| Invariante | Onde é garantida | Como é testada |
|---|---|---|
| **Zero impacto no banco OLTP** | Middleware e buffer assíncrono isolados da transação PostgreSQL | Teste de carga e testes de unidade verificando que nenhuma query SQL é emitida na auditoria de acessos |
| **Sanitização de Dados Sensíveis** | Filtro estrito de payloads no middleware de auditoria | Teste garantindo que senhas, tokens de autorização e valores financeiros brutos não constem no evento |
| **Rastreabilidade de IP Real** | Resolução segura do cabeçalho `x-forwarded-for` considerando proxies reversos confiáveis | Teste de unidade com múltiplos saltos de proxy e IPs spoofados |
| **Correlacionamento OTel/Datadog** | Injeção de `traceId` e `spanId` no contexto assíncrono (`AsyncLocalStorage`) | Teste validando a presença de `traceId` nos logs de auditoria e headers de resposta |
| **Consultabilidade Fiscalizatória** | Endpoint administrativo e schema DDL Athena particionado | Teste de integração do endpoint administrativo validando filtros por IP, Provedor e Data |

---

## 6. Modos de falha

| Falha | Comportamento esperado | Teste |
|---|---|---|
| S3 ou Kinesis indisponível | A API continua processando apostas normalmente sem travar (circuit breaker/degradação graciosa da auditoria externa) | Teste simulando falha de exportação de telemetria |
| IP mascarado / spoof de `x-forwarded-for` | Extração do IP mais à esquerda validado contra proxies confiáveis da VPC/ALB | Teste com cabeçalhos malformados |
| Volume massivo de requisições (DDoS/FDoS) | Ring buffer mantém os últimos N eventos sem estourar heap de memória | Teste de stress de memória com 50.000 requisições consecutivas |

---

## 7. Alternativas consideradas

1. **Gravar auditoria de acessos em tabela PostgreSQL (`access_audit_logs`)**:
   - *Descartada:* Causa contenção de IOPS, bloat de tabela e disputa conexões com o ledger contábil.
2. **Upload síncrono para o S3 por requisição (`s3.putObject`)**:
   - *Descartada:* Adiciona latência inaceitável (>100ms) por chamada e incorre no problema de micro-arquivos caros no S3.
3. **Pipeline Assíncrono com Buffer em Memória + S3 Parquet via Firehose + Athena e OTel/Datadog**:
   - *Adotada:* Combina performance local máxima, consulta imediata via API e persistência imutável de longo prazo com custo próximo a zero.

---

## 8. Observabilidade

- **Métrica**: `http_audit_events_total{status_code, provider_id}`
- **Log Semântico**: `event: "security.audit.access"` com `clientIp`, `providerId`, `path`, `statusCode`, `durationMs`, `traceId`.
- **Datadog / OTel**: Spans HTTP correlacionados via W3C TraceContext.

---

## 9. Plano de testes

- **Unidade**:
  - `audit-logging.middleware.spec.ts`: extração segura de IP, sanitização e emissão de eventos.
  - `audit-trail.port.spec.ts`: filtragem por IP, período, provedor e status.
  - `opentelemetry-tracing.spec.ts`: propagação de contexto W3C e injeção de traceId.
- **Integração**:
  - `audit-admin-api.spec.ts`: chamada aos endpoints administrativos de fiscalização (`/admin/audit`).
- **Concorrência**:
  - Validação de que 50 requisições simultâneas em hot-wallet registram 50 eventos de auditoria sem race conditions na memória.

---

## 10. Plano de implementação

- [ ] 1. Criar as interfaces de auditoria (`SecurityAuditAccessEventDto`, `AuditTrailPort`) em `src/application/ports/audit-trail.port.ts`.
- [ ] 2. Implementar `InMemoryRingBufferAuditTrailAdapter` com capacidade configurável e busca filtrada.
- [ ] 3. Criar `AuditLoggingMiddleware` no NestJS interceptando requisições, capturando IP real e enriquecendo contexto.
- [ ] 4. Criar controller administrativo privado de fiscalização `src/interfaces/http/admin-audit.controller.ts` com documentação OpenAPI.
- [ ] 5. Criar IaC Terraform `infra/terraform/audit.tf` definindo Bucket S3, Kinesis Firehose Parquet e tabelas AWS Athena.
- [ ] 6. Configurar enriquecimento de OpenTelemetry / Datadog no logger estruturado e headers W3C.
- [ ] 7. Escrever suíte de testes unitários e de integração.
- [ ] 8. Gerar ADR-0026 e ADR-0027 registrando as decisões arquiteturais.

