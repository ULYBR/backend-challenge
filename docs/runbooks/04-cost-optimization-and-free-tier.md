# Runbook 04 — Gestão de Custos, Free Tier & Ambientes Econômicos de Teste

Este runbook responde detalhadamente à questão: **"O Free Tier da AWS dá para subir o projeto completo para testar?"** e apresenta estratégias para testar a arquitetura com o menor custo possível (ou custo zero).

---

## 1. A Realidade do AWS Free Tier vs Nossa Arquitetura

O AWS Free Tier oferece muitos recursos gratuitos no primeiro ano, mas **nem todos os componentes enterprise do desafio são 100% gratuitos**.

### Tabela Comparativa de Custos

| Componente da Arquitetura | No AWS Free Tier? | Custo Real Aproximado |
| :--- | :---: | :--- |
| **Amazon EKS (Control Plane)** | ❌ **NÃO** | **$0.10 por hora** (~$73.00/mês). Cobrado desde o minuto em que o cluster é criado. |
| **Instâncias EC2 (Nós do EKS)** | ⚠️ **Parcial** | O Free Tier dá 750h/mês de `t2.micro` ou `t3.micro` (1GB RAM). Nós EKS exigem no mínimo `t3.small` ou `t3.medium` (~$0.0416/hora ou ~$30/mês por nó). |
| **AWS NAT Gateway (VPC)** | ❌ **NÃO** | **$0.045 por hora** (~$32.40/mês por NAT Gateway). Em arquitetura Multi-AZ com 2 ou 3 NATs, custa ~$65 a $100/mês. |
| **Amazon RDS PostgreSQL** | ✅ **SIM** | **750 horas/mês gratuitas** de `db.t4g.micro` ou `db.t3.micro` Single-AZ com 20GB de armazenamento gp2/gp3. |
| **Amazon SQS (FIFO e Standard)** | ✅ **SIM** | **1.000.000 de requisições gratuitas por mês** (para sempre no Free Tier). |
| **Amazon ECR (Container Registry)** | ✅ **SIM** | **500 MB de armazenamento gratuito por mês** por 1 ano. |
| **AWS KMS (Chaves de Criptografia)**| ✅ **SIM** | **20.000 requisições gratuitas por mês**. Chave gerenciada pelo cliente custa $1.00/mês. |
| **AWS Certificate Manager (ACM)** | ✅ **SIM** | **100% Gratuito** para emissão e renovação de certificados públicos SSL/TLS. |
| **Route53 (Hosted Zone)** | ⚠️ **Baixo Custo**| **$0.50 por mês** por zona hospedada. |

> [!WARNING]
> Se você subir o cluster EKS com 2 nós `t3.medium`, RDS e NAT Gateway e deixá-los ligados o mês todo, a fatura será de aproximadamente **$140 a $180 USD**.
> **Portanto, NÃO deixe o EKS ligado continuamente em uma conta de teste pessoal!**

---

## 2. Estratégias Recomendadas para Testar

### Estratégia 1: Teste sob Demanda com Destruição Imediata (Recomendada para Apresentação)
O Terraform permite subir todo o ambiente enterprise (EKS, RDS, SQS, Ingress), executar testes de carga e demonstração por algumas horas e destruir tudo em seguida.

- **Custo estimado para 3 horas de teste**:
  - EKS Control Plane: 3h x $0.10 = **$0.30**
  - 2 Nós EC2 `t3.medium`: 3h x 2 x $0.0416 = **$0.25**
  - NAT Gateway: 3h x $0.045 = **$0.14**
  - **Custo total do teste: ~$0.70 USD (menos de R$ 4,00)!**

**Como fazer**:
```bash
# 1. Subir o ambiente:
cd infra/terraform
terraform apply -auto-approve

# 2. Executar os testes e validar na banca/avaliação...

# 3. AO TERMINAR, DESTRUIR IMEDIATAMENTE:
terraform destroy -auto-approve
```

---

### Estratégia 2: Alternativa Econômica Sem EKS (100% no Free Tier)
Se você precisa manter o ambiente online por semanas para testes contínuos sem custo:

1. **Substituir o EKS por uma única instância EC2 `t4g.small` ou `t3.micro`** executando o container via Docker Compose ou K3s (Kubernetes leve).
2. **Usar o RDS no modo Free Tier**:
   - No `terraform.tfvars`: `db_instance_class = "db.t4g.micro"`
3. **Remover o NAT Gateway**:
   - Colocar a instância em sub-rede pública com IP elástico gratuito, evitando a tarifa do NAT Gateway.
4. **Custo total mensal: $0.00 USD (100% coberto pelo Free Tier)**.

---

### Estratégia 3: Teste 100% Local (Custo Zero Absoluto)
Você não precisa gastar nada na AWS para validar os 97 testes e os 8 cenários de concorrência com PostgreSQL e SQS:

- O projeto já possui o script [`docker-compose.yml`](../../docker-compose.yml) configurado com PostgreSQL 17 e LocalStack (SQS FIFO).
- Todos os testes de integração, concorrência e carga rodam perfeitamente no seu Mac local:
  ```bash
  docker compose up -d
  bun run test:concurrency
  bun run test:e2e
  ```

---

## 3. Configurando Alertas de Faturamento (Budget) na AWS

Para nunca ser surpreendido por cobranças indesejadas na sua nova conta:

1. Acesse o console da AWS: **Billing and Cost Management** > **Budgets**.
2. Clique em **Create budget**.
3. Selecione **Zero spend budget** (alerta se qualquer valor acima de $0.01 for cobrado) ou **Cost budget** com limite de **$5.00 USD**.
4. Configure seu e-mail para receber notificações imediatas.
