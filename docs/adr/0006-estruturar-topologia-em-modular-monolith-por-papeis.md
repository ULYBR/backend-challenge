---
status: Accepted
date: 2026-10-22
deciders: [Ulysses Andrade Leal]
rfc: RFC-0001
---

# ADR-0006 — Estruturar a aplicação como monólito modular parametrizado por papéis (APP_ROLE)

## Contexto e problema

O sistema possui quatro responsabilidades de execução distintas:
1. **API HTTP** (recebimento síncrono de apostas, criação de wallet, consultas, reconciliação, health/metrics);
2. **SQS Consumer** (consumo assíncrono de `wager-transactions.fifo` com inbox);
3. **Outbox Publisher** (publicação assíncrona de eventos confirmados com múltiplos workers concorrentes);
4. **PendingReference Scheduler** (reprocessamento com backoff de transações fora de ordem).

Além disso, as seções 5, 8 e 13 exigem que a solução funcione e seja testada com **3 ou mais instâncias
simultâneas**. Precisamos decidir como empacotar e executar esses componentes.

## Drivers da decisão

- Reutilizar exatamente o mesmo caso de uso (`ProcessWagerTransactionUseCase`) entre HTTP, SQS Consumer e
  PendingReference Worker (exigência explícita da seção 10).
- Subir `>= 3` instâncias reais com facilidade tanto no Docker Compose quanto nos testes de concorrência.
- Permitir isolar papéis em testes específicos (ex.: testar 2 publishers concorrentes sobre a mesma outbox sem
  interferência de outros workers, ou matar apenas o worker consumer após o commit e antes do ack).

## Opções consideradas

1. **Monólito modular em uma única codebase/imagem, com ativação de papéis via `APP_ROLE` (`api`, `consumer`,
   `outbox`, `scheduler` ou `all`)**
2. **Múltiplos microserviços / entrypoints separados com imagens Docker distintas**
3. **Processo único indivisível que sempre sobe todos os workers**

## Decisão

Escolhemos a **Opção 1**: uma única aplicação NestJS onde `APP_ROLE` (ex.: `APP_ROLE=all` ou
`APP_ROLE=consumer,outbox`) controla quais adaptadores ativos (HTTP server, SQS Consumer loop, Outbox loop,
PendingReference loop) são iniciados no bootstrap.

## Consequências

### Positivas

- Zero duplicação de código de domínio, aplicação e persistência.
- Em produção ou no Docker Compose, podemos escalar horizontalmente N réplicas idênticas (`APP_ROLE=all`) ou
  separar deployments por papel (`APP_ROLE=api` vs `APP_ROLE=consumer`) usando a mesma imagem.
- Nos testes de concorrência (seção 13), podemos instanciar subprocessos com papéis cirúrgicos (por exemplo, 2
  processos `APP_ROLE=outbox` disputando a mesma tabela `outbox_messages`).

### Negativas / trade-offs

- Requer cuidado no bootstrap (`main.ts` / `AppModule`) para só iniciar loops de background e só fazer `listen()`
  na porta HTTP quando o respectivo papel estiver habilitado.

### Como validar

- Teste de integração sobe múltiplas instâncias com configurações de `APP_ROLE` distintas e verifica que apenas
  os workers configurados entram em execução.

## Referências

- [RFC-0001 — Stack tecnológica, scaffolding hexagonal e topologia de execução](../rfc/RFC-0001-stack-scaffolding-e-topologia.md)

