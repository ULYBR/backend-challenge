# Infrastructure as Code — Distributed Wagering Processor

Guia da infraestrutura provisionada via **Terraform**, com suporte para **Amazon EKS** (Kubernetes), **RDS PostgreSQL 17 com RDS Proxy**, **SQS FIFO & DLQ**, **KMS CMK**, **Secrets Manager**, e **ArgoCD / GitOps**.

---

## 1. Padrões de Design e Melhores Práticas Aplicados

### 1.1 Centralized `locals.tf` Pattern
- **DRY e Governança**: Nomenclatura corporativa padronizada em `${local.name_prefix}` (`<project>-<environment>`).
- **Multi-Region Dinâmico**: As zonas de disponibilidade (AZs) não são hardcoded; o data source `data.aws_availability_zones.available` seleciona dinamicamente até 3 AZs disponíveis na região configurada em `var.aws_region` (`us-east-1`, `sa-east-1`, `eu-west-1`, etc.).
- **Tagging Corporativo**: FinOps, SecOps e Compliance tags (`Project`, `Environment`, `ManagedBy`, `Region`, `Workload`, `Compliance: pci-dss-financial-grade`) propagadas unificadamente via `merge(local.common_tags, ...)`.

### 1.2 Separação Limpa: Terraform (Cloud) + GitOps ArgoCD & Helm (Workloads)
- A arquitetura segue a divisão padrão-ouro da indústria:
  - **Terraform (`infra/terraform/`)**: Provisiona exclusivamente a infraestrutura de nuvem gerenciada na AWS: VPC, Subnets, Cluster EKS 1.31, Managed Node Groups, RDS PostgreSQL 17 com RDS Proxy, SQS FIFO, KMS CMK, ECR e IAM com IRSA.
  - **Helm & ArgoCD (`infra/helm/` e `infra/argocd/`)**: Provisionam e gerenciam o ciclo de vida dos **Pods e Workloads** da aplicação dentro do cluster (Deployments, Services, Ingress, HPA, KEDA e ConfigMaps/Secrets).
  - Essa separação elimina conflitos de estado entre Terraform e ArgoCD, garantindo portabilidade total para qualquer nuvem (EKS, GKE, AKS ou Kind local).
  - Suporte nativo a `CronJob`s no Kubernetes para tarefas agendadas de consolidação de saldo e conciliação contábil batch.

### 1.3 Princípio do Menor Privilégio (Least Privilege IAM)
Em vez de uma IAM Role com permissões globais, cada `APP_ROLE` possui uma IAM Role e Policy estritamente delimitadas (`infra/terraform/iam.tf`):
- **API (`app_role_api`)**:
  - Acesso: RDS Proxy (`rds-db:connect`), Secrets Manager (`GetSecretValue`), KMS (`Decrypt`).
  - **Zero permissões de SQS**.
- **Consumer (`app_role_consumer`)**:
  - Acesso: Leitura exclusiva da fila inbound SQS (`ReceiveMessage`, `DeleteMessageBatch`, `ChangeMessageVisibility`), publicação na DLQ (`SendMessage`), RDS Proxy, Secrets Manager e KMS.
  - **Zero permissões na fila de eventos externos**.
- **Outbox Relay (`app_role_outbox`)**:
  - Acesso: Leitura de outbox no banco de dados e publicação estrita na fila de eventos (`SendMessage`, `SendMessageBatch`), RDS Proxy, Secrets Manager e KMS.
  - **Zero permissões de consumo da fila de transações**.
- **Scheduler Worker (`app_role_scheduler`)**:
  - Acesso: Resolução de transações pendentes expiradas diretamente no banco de dados via RDS Proxy.
  - **Zero permissões em filas SQS**.

### 1.4 Segurança e Criptografia em Repouso
- **AWS KMS CMK Dedicado** (`infra/terraform/kms.tf`): Rotação anual automática de chaves criptográficas (`enable_key_rotation = true`).
- **Criptografia Unificada**:
  - RDS PostgreSQL 17 (`gp3` criptografado via KMS).
  - SQS FIFO e DLQ criptografados via KMS.
  - ECR Image Repository com varredura contínua contra vulnerabilidades (`scan_on_push = true`) e KMS CMK.
  - EKS Secrets Envelope Encryption: os Secrets do Kubernetes no cluster EKS são criptografados na control plane usando o KMS CMK (`encryption_config { resources = ["secrets"] }`).
  - AWS Secrets Manager (`infra/terraform/secrets.tf`): Credenciais de banco protegidas via KMS e injetadas no RDS Proxy.

---

## 2. Nomenclatura de Filas SQS Corporativas

As filas SQS seguem o padrão corporativo de alta escalabilidade:
```
<project>-<environment>-<domain>-<purpose>[.fifo]
```
Exemplos provisionados:
- Inbound: `wagering-processor-production-transactions-inbound.fifo`
- DLQ: `wagering-processor-production-transactions-dlq.fifo`
- Events: `wagering-processor-production-wallet-events.fifo`

---

## 3. Estrutura de Arquivos

```
infra/terraform/
├── versions.tf      # Requisitos de versão Terraform (>= 1.6) e AWS Provider (~> 5.0)
├── variables.tf     # Variáveis de entrada parametrizadas (region, vpc_cidr, instâncias, etc.)
├── locals.tf        # Nomenclaturas, tags corporativas e seleção dinâmica de AZs
├── network.tf       # VPC, Subnets Públicas/Privadas, NAT Gateway, Security Groups
├── kms.tf           # AWS KMS Customer Managed Key (CMK) com auto-rotação
├── secrets.tf       # AWS Secrets Manager com envelope encryption via KMS
├── iam.tf           # IAM Roles segregadas por APP_ROLE (Least Privilege) com IRSA para EKS
├── ecr.tf           # Repositório Docker com scan de segurança e lifecycle rules
├── sqs.tf           # Filas SQS FIFO, DLQ e integração de eventos
├── rds.tf           # PostgreSQL 17 Multi-AZ com AWS RDS Proxy
├── eks.tf           # Cluster Amazon EKS 1.31, Managed Node Groups, OIDC Provider e KMS
└── outputs.tf       # Endpoints públicos, URLs de filas e ARNs para CI/CD
```

---

## 4. Provisionamento dos Pods no Cluster EKS via GitOps (ArgoCD & Helm)

O provisionamento das cargas de trabalho (Pods) no cluster EKS é gerenciado pelo **ArgoCD** através do Helm Chart [`infra/helm/distributed-wagering-processor/`](../helm/distributed-wagering-processor/):

1. **Namespace `wagering`**: Namespace dedicado e isolado para as cargas de trabalho.
2. **ServiceAccounts com IRSA (IAM Roles for Service Accounts)**:
   - `wagering-processor-production-api` $\rightarrow$ Assume `role-api` (sem acesso a filas).
   - `wagering-processor-production-consumer` $\rightarrow$ Assume `role-consumer` (leitura inbound e DLQ).
   - `wagering-processor-production-outbox` $\rightarrow$ Assume `role-outbox` (publicação de eventos).
   - `wagering-processor-production-scheduler` $\rightarrow$ Assume `role-scheduler` (apenas banco).
3. **Pods da API (`deployment-api`)**:
   - Rodam com `APP_ROLE=api` na porta 3000.
   - Conectam-se ao RDS Proxy e expõem `/health/live`, `/health/ready` e `/metrics`.
   - Auto-escalados horizontalmente via **HPA** de 2 a 20 Pods baseado em CPU (> 65%) e tráfego.
4. **Pods Consumidores (`deployment-consumer`)**:
   - Rodam com `APP_ROLE=consumer`.
   - Consomem mensagens da fila SQS FIFO com Inbox transacional.
   - Auto-escalados instantaneamente de 2 a 30 Pods via **KEDA ScaledObject** baseado na profundidade da fila SQS.
5. **Pods da Outbox (`deployment-outbox`)**:
   - Rodam com `APP_ROLE=outbox`.
   - Drenam eventos da tabela `outbox_messages` via `SKIP LOCKED` e publicam na fila SQS de eventos.
6. **Pods do Scheduler (`deployment-scheduler`)**:
   - Rodam com `APP_ROLE=scheduler`.
   - Reavaliam e consolidam transações pendentes (`PENDING_REFERENCE`).

---

## 4. Deploy e Automação

### 4.1 Inicialização e Validação
```bash
cd infra/terraform
terraform init
terraform fmt -check
terraform validate
terraform plan -out=tfplan
```

### 4.2 Alteração de Região (Multi-Region Agility)
Para realizar o deploy em outra região (ex.: São Paulo `sa-east-1` ou Frankfurt `eu-central-1`):
```bash
terraform apply -var="aws_region=sa-east-1"
```
O arquivo `locals.tf` detecta as AZs disponíveis na nova região dinamicamente, sem necessidade de alterar o código do Terraform.

### 4.3 GitOps & ArgoCD
O chart Helm em `infra/helm/wagering-processor` é sincronizado automaticamente pelo ArgoCD através do manifesto em `infra/argocd/application.yaml`.
Qualquer alteração na branch `main` dispara o pipeline do GitHub Actions (`.github/workflows/cd-prod.yaml`), que:
1. Executa linting e testes unitários/integração.
2. Constrói o container Docker com otimização multi-stage.
3. Executa varredura de vulnerabilidades de imagem via **Trivy**.
4. Publica a imagem no Amazon ECR.
5. Notifica o ArgoCD para efetuar o rollout canário ou blue/green nos nós EKS.

