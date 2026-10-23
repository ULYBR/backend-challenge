# ADR-0020: Ponto de extensão de autenticação (`ProviderIdentityPort` + `ProviderAuthGuard`) e infraestrutura escalável com Terraform e Auto Scaling

- **Status**: Accepted
- **Data**: 2026-10-22
- **Fase do roadmap**: 10 — Autenticação (ponto de extensão) & Infraestrutura Terraform / Auto Scaling

## Contexto e problema

1. **Autenticação (Seção 5 do desafio)**: O desafio especifica que a autenticação de provedores de jogos deve ser representada como um ponto de extensão claro no código (`Guard` + `Port`) sem exigir um servidor de identidade externo rodando no `docker compose` local, documentando-se o desenho de produção com OIDC `client_credentials` (Keycloak).
2. **Escalabilidade horizontal e Infraestrutura como Código (IaC)**: A arquitetura por papéis (`APP_ROLE=api|consumer|outbox|scheduler`) foi desenhada para escalar horizontalmente sem estado em memória, mas precisa de uma definição concreta em **Terraform (`infra/terraform/`)** com políticas de **Auto Scaling** independentes por papel, **RDS Proxy** para proteger o pool de conexões do PostgreSQL 17 e filas **SQS FIFO**.

## Opções consideradas

1. **`ProviderIdentityPort` + `ProviderAuthGuard` (no-op local / OIDC JWKS em produção) + Terraform modularizado em `infra/terraform/` provisionando ECS Fargate por `APP_ROLE`, Application Auto Scaling, RDS PostgreSQL 17 + RDS Proxy e SQS FIFO**
2. **Subir Keycloak obrigatório no Docker Compose local e manter infraestrutura de produção apenas em texto**
3. **Hardcodar validação de API Key estática nos controllers**

## Decisão

Adotar a **Opção 1**:

### 1. Autenticação (`ProviderIdentityPort` + `ProviderAuthGuard`)

- A camada de aplicação define `ProviderIdentityPort` (`TOKENS.PROVIDER_IDENTITY_PORT`) que resolve um `AuthenticatedProviderPrincipalDto` (`providerId`, `clientId`, `scopes`).
- `ProviderAuthGuard` intercepta as rotas HTTP (ignorando `/health/*` e `/metrics`), extrai o cabeçalho `Authorization` / `x-provider-id`, invoca `ProviderIdentityPort.authenticate(...)` e anexa o principal à requisição.
- No ambiente local/teste, `NoopProviderIdentityAdapter` aceita requisições sem exigir Keycloak externo e valida consistência se `x-provider-id` for informado.
- Em produção, basta injetar `KeycloakJwksProviderIdentityAdapter` validando JWT `RS256` emitido via OIDC `client_credentials` (`iss`, `aud`, `exp`, claim `provider_id`) contra o endpoint JWKS do Keycloak.

### 2. Infraestrutura Terraform e Auto Scaling (`infra/terraform/`)

- **Rede (`network.tf`)**: VPC multi-AZ com sub-redes públicas (ALB) e privadas (ECS Fargate, EKS, RDS Proxy, RDS PostgreSQL 17).
- **Registro de Imagens (`ecr.tf`)**: Amazon ECR com tag immutability, KMS encryption e scan de vulnerabilidades no push.
- **Banco de Dados (`rds.tf`)**: Amazon RDS PostgreSQL 17 Multi-AZ + **Amazon RDS Proxy** (multiplexando conexões transacionais das tasks ECS/Pods EKS para evitar exaustão de `max_connections` durante *scale-out*).
- **Mensageria (`sqs.tf`)**: Filas `wager-transactions.fifo`, `wager-transactions-dlq.fifo` (com `RedrivePolicy`) e `wallet-events.fifo`.
- **Computação via ECS Fargate (`ecs.tf`, `autoscaling.tf`)**: 4 serviços ECS Fargate com Target Tracking por CPU e profundidade de fila SQS.
- **Computação via Amazon EKS + Helm Chart (`eks.tf`, `infra/helm/distributed-wagering-processor/`)**:
  - Cluster EKS Kubernetes 1.31 com node groups em subnets privadas.
  - Helm Chart completo com Deployments segregados por `APP_ROLE` (`api`, `consumer`, `outbox`, `scheduler`).
  - Auto-scaling de Pods via **HPA** (`cpu > 65%`, `memory > 75%`) para a API e **KEDA ScaledObject** para o Consumer SQS baseado na profundidade da fila (`ApproximateNumberOfMessagesVisible`).

## Consequências

### Positivas

- Zero dependência pesada (Keycloak/JVM) para rodar `docker compose up` e a suíte de testes local.
- Infraestrutura AWS reproduzível com `terraform init && terraform plan`, com escalonamento independente entre ingestão HTTP, consumo SQS e publicação de Outbox.

### Negativas / trade-offs

- Em modo `NoopProviderIdentityAdapter`, a assinatura criptográfica de tokens JWT não é exercitada localmente (o desenho completo fica documentado em `ARCHITECTURE.md`).

