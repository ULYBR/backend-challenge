# Runbook 03 — Provisionamento de Infraestrutura & GitOps (Terraform, Helm & ArgoCD)

Este runbook orienta a execução completa do provisionamento da infraestrutura em nuvem na AWS via Terraform, conexão do `kubectl` com o cluster Amazon EKS e deploy dos Pods via Helm e ArgoCD.

---

## 1. Passo a Passo do Provisionamento com Terraform

### 1.1 Inicialização
Navegue até o diretório de infraestrutura:
```bash
cd infra/terraform
terraform init
```

### 1.2 Configuração de Variáveis (`terraform.tfvars`)
Crie o arquivo `terraform.tfvars` com as configurações do seu ambiente:
```hcl
aws_region       = "us-east-1"
environment      = "production"
project_name     = "wagering-processor"
github_repository = "ULYBR/backend-challenge"

# Opcional: Se for conectar seu domínio próprio
domain_name      = "minhaempresa.com.br"
api_subdomain    = "api"

# Senha segura para o banco PostgreSQL
db_password      = "SuaSenhaSeguraPostgres2026!"
```

### 1.3 Planejamento e Aplicação
```bash
terraform plan -out=tfplan
terraform apply tfplan
```

> [!NOTE]
> O provisionamento do cluster EKS e do RDS PostgreSQL leva aproximadamente entre 12 e 18 minutos.

---

## 2. Conectando o `kubectl` ao Cluster EKS

Após o `terraform apply` concluir:

```bash
aws eks update-kubeconfig \
  --region us-east-1 \
  --name wagering-processor-production-eks

# Verificar conectividade e nós do cluster:
kubectl get nodes -o wide
```

---

## 3. Instalação dos Add-ons Essenciais do Cluster

Para que o cluster gerencie o Load Balancer e o autoscaling por fila SQS:

### 3.1 AWS Load Balancer Controller
```bash
helm repo add eks https://aws.github.io/eks-charts
helm repo update

helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system \
  --set clusterName=wagering-processor-production-eks \
  --set serviceAccount.create=true \
  --set serviceAccount.name=aws-load-balancer-controller
```

### 3.2 KEDA (Kubernetes Event-driven Autoscaling)
```bash
helm repo add kedacore https://kedacore.github.io/charts
helm repo update

helm install keda kedacore/keda \
  --namespace keda \
  --create-namespace
```

---

## 4. Deploy da Aplicação via Helm

```bash
cd infra/helm/distributed-wagering-processor

# Criar namespace dedicado
kubectl create namespace wagering

# Instalar a aplicação em produção
helm upgrade --install wagering-processor . \
  --namespace wagering \
  -f values.yaml \
  -f values-prod.yaml
```

Verifique o status dos Pods:
```bash
kubectl get pods -n wagering -l app.kubernetes.io/part-of=wagering-processor
```

Deverão ser exibidos:
- Pods da `API` (gerenciados pelo Deployment e HPA).
- Pods do `Consumer` (gerenciados pelo Deployment e KEDA SQS Scaler).
- Pods dos `Workers` (`outbox-publisher` e `pending-reference-resolver`).

---

## 5. Configuração do GitOps com ArgoCD

O repositório já conta com manifestos nativos em [`infra/argocd/`](../../infra/argocd/):

1. **Instalar o ArgoCD no Cluster**:
   ```bash
   kubectl create namespace argocd
   kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
   ```
2. **Aplicar o Projeto e Aplicação Declarativa**:
   ```bash
   kubectl apply -f infra/argocd/project.yaml
   kubectl apply -f infra/argocd/application.yaml
   ```
3. O ArgoCD passará a monitorar a branch `main` e reconciliará alterações nos valores do Helm automaticamente.
