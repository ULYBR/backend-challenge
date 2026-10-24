---
status: Accepted
date: 2026-10-23
deciders: [Time de Engenharia]
rfc: RFC-0012
---

# ADR-0026 — Trilha de Auditoria Fiscalizatória via S3 Parquet, AWS Athena e Endpoint Administrativo

## Contexto e problema

Plataformas financeiras e de apostas distribuídas precisam registrar trilhas completas de auditoria de segurança (quem acessou, qual IP, qual provedor, qual rota, qual operação foi executada e qual foi o resultado). 
Gravar esses eventos no banco de dados transacional PostgreSQL (`wallets`, `wager_transactions`, `wallet_ledger_entries`) causa inchaço de dados (bloat), saturação de IOPS e disputa de conexões, degradando o processamento de apostas.
Por outro lado, armazenar dados de auditoria sem um meio direto de consulta inviabiliza fiscalizações e auditorias regulatórias (compliance SPA/MF e PCI-DSS).

## Drivers da decisão

- **Performance do Banco Transacional**: Zero escritas de auditoria HTTP concorrendo com transações financeiras ACID no PostgreSQL.
- **Consultabilidade Fiscalizatória Imediata**: Capacidade de o time de auditoria/SRE consultar acessos em tempo real via endpoint administrativo (`GET /api/v1/admin/audit`).
- **Data Lake Serverless de Longo Prazo**: Armazenamento imutável, econômico e colunar no Amazon S3 em formato **Apache Parquet com Snappy**.
- **Consultas SQL em Lote via AWS Athena**: Permitir queries analíticas SQL particionadas (`year/month/day/hour`) sem manter infraestrutura de banco de dados analítico ligada 24/7.
- **Rastreabilidade Segura**: Extração confiável do IP real do cliente via `x-forwarded-for` com proteção contra spoofing.

## Opções consideradas

1. **Gravar auditoria em tabela do PostgreSQL transacional (`http_access_audit_logs`)**:
   - *Prós:* Simplicidade inicial de consulta com `SELECT`.
   - *Contras:* Destrói a performance do banco OLTP; incha o banco com milhões de linhas; aumenta custos de backup e tempo de replicação.
2. **Gravação síncrona de cada requisição no Amazon S3 (`s3.putObject`)**:
   - *Prós:* Não onera o banco de dados.
   - *Contras:* Aumenta a latência em cada requisição financeira (+100ms a +200ms) e cria o problema de milhões de pequenos arquivos (aumentando os custos de API PUT do S3).
3. **Pipeline Híbrido: Buffer de Fiscalização Imediata em Memória + Ingestão em Lote para S3 Parquet via Firehose + Consultas AWS Athena**:
   - *Prós:* Zero latência adicional na requisição; zero impacto no PostgreSQL; consulta imediata dos últimos 10.000 eventos via API administrativa; retenção histórica imutável e barata em Parquet no S3 consultável via SQL no Athena.
   - *Contras:* Requer especificação de IaC no Terraform para o bucket S3 e tabela Athena.

## Decisão

Adotamos a **Opção 3**:

1. **Na Camada da Aplicação**:
   - Criar `AuditLoggingMiddleware` no NestJS interceptando requisições, capturando `clientIp` (via `req.ip` ou `x-forwarded-for`), `providerId` autenticado, `method`, `path`, `statusCode`, `durationMs`, `correlationId`, `traceId` e `userAgent`.
   - Alimentar uma porta `AuditTrailPort` com implementação `InMemoryRingBufferAuditTrailAdapter` que mantém uma janela deslizante dos últimos 10.000 eventos para inspeção e fiscalização imediata em runtime.
   - Emitir o evento de log estruturado JSON em stdout (`event: "security.audit.access"`), sem dados financeiros brutos nem credenciais.
2. **Na Camada de Fiscalização Administrativa (HTTP)**:
   - Expor o endpoint protegido `GET /api/v1/admin/audit` permitindo que auditores e operadores filtrem eventos por `providerId`, `walletId`, `clientIp`, `statusCode` e intervalo de tempo.
3. **Na Camada de Armazenamento e Big Data (AWS IaC)**:
   - Definir em Terraform (`infra/terraform/audit.tf`) o Bucket S3 com SSE-KMS, Kinesis Data Firehose para conversão em lote para **Apache Parquet**, e catálogo de tabelas **AWS Athena** particionado por `year/month/day/hour`.

## Consequências

### Positivas

- O banco de dados PostgreSQL permanece 100% focado no processamento transacional de alta velocidade.
- O time de conformidade/fiscalização pode inspecionar acessos suspeitos tanto via API quanto via SQL no Athena.
- Redução de até 80% nos custos de armazenamento e consulta com o formato colunar Parquet em comparação a JSON puro.

### Negativas / trade-offs

- Eventos mais antigos que a capacidade do ring buffer em memória dependem do pipeline do S3/Athena para serem consultados.

## Referências

- [RFC-0012](../rfc/RFC-0012-trilha-de-auditoria-fiscalizatoria-e-observabilidade-opentelemetry-datadog.md)
- [ADR-0019](0019-expor-metricas-prometheus-e-logs-estruturados-sem-dados-sensiveis.md)
- [ADR-0022](0022-mitigacao-owasp-api-security-e-rate-limiting.md)

