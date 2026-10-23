# Runbook 05 — Resposta a Incidentes, DLQ Re-Drive & Recuperação de Desastres

Este runbook define os procedimentos operacionais para diagnóstico, contenção e mitigação de incidentes em ambiente produtivo do **Distributed Wagering Processor**.

---

## 1. Tratamento de Mensagens na Dead Letter Queue (DLQ)

Quando uma mensagem de aposta falha reiteradamente (ex: payload JSON corrompido ou erro fatal de infraestrutura após esgotar retentativas), ela é isolada na SQS Dead Letter Queue (`wager-transactions-dlq.fifo`).

### 1.1 Inspecionando a DLQ
```bash
# Obter contagem de mensagens na DLQ:
aws sqs get-queue-attributes \
  --queue-url "https://sqs.us-east-1.amazonaws.com/SEU_ACCOUNT_ID/wagering-processor-production-wager-transactions-dlq.fifo" \
  --attribute-names ApproximateNumberOfMessages
```

### 1.2 Lendo Mensagens da DLQ para Diagnóstico
```bash
aws sqs receive-message \
  --queue-url "https://sqs.us-east-1.amazonaws.com/SEU_ACCOUNT_ID/wagering-processor-production-wager-transactions-dlq.fifo" \
  --max-number-of-messages 1 \
  --attribute-names All \
  --message-attribute-names All
```

### 1.3 Executando o Re-Drive Seguro
Após corrigir o problema de rede ou formato de payload:
```bash
# Iniciar o redrive da DLQ de volta para a fila principal:
aws sqs start-message-move-task \
  --source-arn "arn:aws:sqs:us-east-1:SEU_ACCOUNT_ID:wagering-processor-production-wager-transactions-dlq.fifo" \
  --destination-arn "arn:aws:sqs:us-east-1:SEU_ACCOUNT_ID:wagering-processor-production-wager-transactions.fifo"
```

---

## 2. Reconciliação e Auditoria de Inconsistência de Saldo

A invariante financeira mandatória do sistema é:
$$\text{wallet.balance} = \sum \text{wallet\_ledger\_entries.delta}$$

Se por qualquer motivo houver suspeita de divergência em uma carteira, utilize a API de reconciliação:

```bash
# Disparar reconciliação forçada para uma carteira específica:
curl -X POST https://api.minhaempresa.com.br/wallets/w-12345/reconcile \
  -H "Content-Type: application/json"
```

**Comportamento do Endpoint**:
1. Bloqueia a carteira com `SELECT ... FOR UPDATE` (isolando concorrência).
2. Soma todas as entradas históricas do ledger imutável (`wallet_ledger_entries`).
3. Compara com o saldo em cache na tabela `wallets`.
4. Se houver divergência, atualiza o saldo da carteira para o valor matematicamente comprovado pelo ledger e registra log estruturado `wallet.reconciled.divergence_corrected`.

---

## 3. Diagnóstico de Concorrência e Bloqueios (Hot Wallets)

Em casos de lentidão extrema por disputa de saldo em uma mesma carteira (`SELECT FOR UPDATE`), inspecione as conexões ativas no PostgreSQL:

```sql
SELECT 
    pid, 
    now() - pg_stat_activity.query_start AS duration, 
    query, 
    state,
    wait_event_type,
    wait_event
FROM pg_stat_activity
WHERE state != 'idle'
ORDER BY duration DESC;
```

Para cancelar uma transação bloqueante órfã:
```sql
SELECT pg_cancel_backend(PID_DO_PROCESSO);
```

---

## 4. Rollback Emergencial de Release

Se uma nova versão introduzir uma regressão:

### Via ArgoCD (GitOps)
```bash
# Reverter a aplicação para o commit anterior:
git revert HEAD -m "revert: rollback release to previous stable commit"
git push origin main
```
O ArgoCD detectará o push e fará o rollback automático para a versão estável em menos de 60 segundos.

### Via Helm (Manual Emergencial)
```bash
# Listar o histórico de releases:
helm history wagering-processor -n wagering

# Fazer o rollback para a revisão anterior (ex: revisão 1):
helm rollback wagering-processor 1 -n wagering
```
