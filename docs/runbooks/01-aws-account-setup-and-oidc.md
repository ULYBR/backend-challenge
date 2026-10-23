# Runbook 01 — Configuração da Conta AWS & OIDC para GitHub Actions

Este runbook orienta a configuração de uma nova conta AWS para receber a infraestrutura do **Distributed Wagering Processor**, estabelecendo a federação de identidade OpenID Connect (OIDC) com o GitHub Actions sem o uso de chaves estáticas de acesso (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`).

---

## 1. Pré-Requisitos na Conta AWS

1. Uma conta AWS ativa (com cartão de crédito cadastrado para o Free Tier).
2. Usuário IAM com permissões de administrador e **MFA ativado** (evite usar a conta *root* no dia a dia).
3. AWS CLI instalado e configurado localmente:
   ```bash
   aws configure
   # Informe AWS Access Key ID, Secret Access Key e Default region (ex: us-east-1)
   ```

---

## 2. Configurando o OIDC para GitHub Actions (Keyless Authentication)

Para que a esteira de CD do GitHub Actions compile, assine com Cosign e publique a imagem no Amazon ECR, a AWS precisa confiar no emissor de tokens do GitHub (`https://token.actions.githubusercontent.com`).

### Opção A: Provisionamento Automatizado via Terraform (Recomendado)

O arquivo [`infra/terraform/github_oidc.tf`](../../infra/terraform/github_oidc.tf) já contém toda a declaração de recursos.

1. Navegue até o diretório Terraform:
   ```bash
   cd infra/terraform
   ```
2. Aplique a configuração:
   ```bash
   terraform apply -target=aws_iam_openid_connect_provider.github_actions \
                   -target=aws_iam_role.github_actions_ecr_push \
                   -target=aws_iam_policy.github_actions_ecr_push \
                   -target=aws_iam_role_policy_attachment.github_actions_ecr_push \
                   -target=aws_ecr_repository.app
   ```
3. Copie o ARN da role gerada na saída:
   ```bash
   terraform output github_actions_role_arn
   # Exemplo: arn:aws:iam::123456789012:role/github-actions-ecr-push
   ```

---

### Opção B: Configuração Manual via AWS CLI

Caso queira configurar antes de rodar o Terraform completo:

1. **Criar o Provedor OIDC**:
   ```bash
   aws iam create-open-id-connect-provider \
     --url "https://token.actions.githubusercontent.com" \
     --client-id-list "sts.amazonaws.com" \
     --thumbprint-list "6938fd4d98bab03faadb97b34396831e3780aea1" "1c5876126b3040e277a7f31c5eed7a02c842b150"
   ```

2. **Criar a Trust Policy (`trust-policy.json`)**:
   Substitua `SEU_ACCOUNT_ID` pelo seu ID de conta AWS e `ULYBR/backend-challenge` pelo seu repositório:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Principal": {
           "Federated": "arn:aws:iam::SEU_ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
         },
         "Action": "sts:AssumeRoleWithWebIdentity",
         "Condition": {
           "StringLike": {
             "token.actions.githubusercontent.com:sub": "repo:ULYBR/backend-challenge:*"
           },
           "StringEquals": {
             "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
           }
         }
       }
     ]
   }
   ```

3. **Criar a IAM Role**:
   ```bash
   aws iam create-role \
     --role-name github-actions-ecr-push \
     --assume-role-policy-document file://trust-policy.json
   ```

4. **Anexar a Política de Permissões ao ECR**:
   ```bash
   aws iam attach-role-policy \
     --role-name github-actions-ecr-push \
     --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryPowerUser
   ```

---

## 3. Configurando a Secret no Repositório GitHub

Com o ARN da Role em mãos, configure no GitHub:

1. Acesse o repositório no GitHub: `https://github.com/ULYBR/backend-challenge/settings/secrets/actions`
2. Clique em **New repository secret**.
3. **Name**: `AWS_ROLE_ARN`
4. **Value**: `arn:aws:iam::SEU_ACCOUNT_ID:role/github-actions-ecr-push`
5. Clique em **Add secret**.

> [!TIP]
> A partir desse momento, as esteiras `cd-dev.yaml` e `cd-prod.yaml` no GitHub Actions autenticarão automaticamente na AWS via OIDC temporário, sem precisar de credenciais estáticas.

---

## 4. Criando o Repositório no Amazon ECR

Para armazenar a imagem Docker do projeto:

```bash
aws ecr create-repository \
  --repository-name wagering-processor-app \
  --image-tag-mutability IMMUTABLE \
  --image-scanning-configuration scanOnPush=true \
  --region us-east-1
```
