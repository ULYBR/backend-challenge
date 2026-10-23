# Runbooks Operacionais — Distributed Wagering Processor

Este diretório contém os procedimentos operacionais padrão (SOPs), runbooks de infraestrutura em nuvem, configuração de ambientes, segurança e resposta a incidentes para o **Distributed Wagering Processor**.

---

## Índice de Runbooks

| Runbook | Descrição | Público-Alvo |
| :--- | :--- | :--- |
| [**01. Configuração da Conta AWS & OIDC GitHub Actions**](01-aws-account-setup-and-oidc.md) | Setup inicial da conta AWS, credenciais OIDC keyless para o GitHub Actions e ECR | DevOps / SRE |
| [**02. Domínio Próprio, Route53, Certificados ACM & Ingress Público**](02-domain-route53-acm-and-ingress.md) | Como conectar o domínio corporativo, emitir SSL/TLS grátis e expor a API na internet via ALB | DevOps / SRE |
| [**03. Provisionamento de Infraestrutura & GitOps (Terraform, Helm & ArgoCD)**](03-infrastructure-deployment-and-gitops.md) | Passo a passo de deploy automatizado do cluster EKS, banco RDS, SQS FIFO e pods | DevOps / Backend |
| [**04. Gestão de Custos, Free Tier & Ambientes Econômicos de Teste**](04-cost-optimization-and-free-tier.md) | Análise detalhada do que cabe no Free Tier da AWS, custos de EKS e estratégias de economia | Tech Lead / FinOps |
| [**05. Resposta a Incidentes, DLQ Re-Drive & Recuperação de Desastres**](05-disaster-recovery-and-incident-response.md) | Procedimentos para mensagens na DLQ, auditoria e reconciliação de saldo e rollback | SRE / On-call |

---

## Princípios Operacionais

1. **Zero Chaves Estáticas na Nuvem**: Toda autenticação entre GitHub Actions e AWS ocorre via tokens efêmeros OIDC (`sts:AssumeRoleWithWebIdentity`).
2. **Infraestrutura como Código (IaC) e GitOps**: Nenhuma alteração manual no console da AWS; tudo é versionado via Terraform e reconciliado pelo ArgoCD.
3. **Auditoria e Reversibilidade**: Toda operação financeira possui rastro no append-only ledger (`wallet_ledger_entries`) e pode ser reconciliada a qualquer momento.
