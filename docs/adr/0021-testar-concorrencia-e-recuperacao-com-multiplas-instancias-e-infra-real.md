# ADR-0021: Testar concorrência e recuperação com múltiplas instâncias reais da aplicação sobre PostgreSQL e SQS em containers

- **Status**: Accepted
- **Data**: 2026-10-22
- **Fase do roadmap**: 11 — Hardening de testes
- **RFC relacionada**: [RFC-0009](../rfc/RFC-0009-suite-concorrencia-multi-instancia-e-teste-de-carga.md)

## Contexto e problema

Mocks em memória de banco de dados ou filas não reproduzem contenção real de locks (`SELECT ... FOR UPDATE`), violações concorrentes de `UNIQUE INDEX`, *visibility timeout* de filas SQS nem *lease* com `FOR UPDATE SKIP LOCKED`. Além disso, a Seção 13 exige explicitamente testar com **≥ 3 instâncias simultâneas** e verificar a invariante `wallet.balance == saldo reconstruído pelo ledger` ao término de todos os testes.

## Opções consideradas

1. **Instanciar ≥ 3 contextos/servidores NestJS independentes (`INSTANCE_ID=instance-1..3`), cada um com seu próprio pool de conexões PostgreSQL e cliente SQS apontando para os containers reais, e encerrar cada teste com `assertAllWalletsMatchLedger`**
2. **Simular concorrência com uma única instância e mocks de repositório**

## Decisão

Adotar a **Opção 1**:

1. Os testes de concorrência (`test/concurrency/`) levantam no mínimo 3 instâncias independentes da aplicação (`NestFactory.create`), cada uma escutando em sua própria porta TCP efêmera e mantendo seu próprio pool de conexões MikroORM/PostgreSQL.
2. As requisições concorrentes (`Promise.all`) são distribuídas em *round-robin* entre as 3 instâncias simultâneas.
3. Todo teste de integração e concorrência invoca obrigatoriamente `assertAllWalletsMatchLedger(em, reconcileUseCase)` ao final, validando que `wallet.balance == sum(CREDIT) - sum(DEBIT)` e que a cadeia `wallet_version 1..N` é contínua para todas as carteiras existentes no banco.

## Consequências

### Positivas

- Prova empírica de que nenhuma invariante financeira depende de estado em memória de uma única instância.
- Reproduz fielmente o comportamento de múltiplas tasks ECS Fargate sob Auto Scaling.

### Negativas / trade-offs

- Exige containers PostgreSQL 17 e MiniStack ativos durante a execução de `bun run test:integration` e `bun run test:concurrency`.

