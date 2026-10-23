---
status: Accepted
date: 2026-10-22
deciders: [Ulysses Andrade Leal]
rfc: RFC-0001
---

# ADR-0005 — Adotar MiniStack como emulador SQS padrão no Docker Compose mantendo compatibilidade com LocalStack

## Contexto e problema

A seção 4 do desafio especifica: "Mensageria: **AWS SQS** via **LocalStack** ou **MiniStack**". A imagem oficial
unificada do LocalStack passou a exigir uma conta e a variável `LOCALSTACK_AUTH_TOKEN` para iniciar. Se o
`docker-compose.yml` exigir um token pessoal do LocalStack, qualquer avaliador que rodar `docker compose up` sem
configurar conta própria terá falha no boot do container de mensageria.

## Drivers da decisão

- Execução `docker compose up` imediata e sem dependência de conta/token externo ("zero-auth").
- Suporte completo a filas SQS FIFO (`wager-transactions.fifo`, `wager-transactions-dlq.fifo`), redrive policy
  (`maxReceiveCount`), `ChangeMessageVisibility` e deleção de mensagens via `@aws-sdk/client-sqs`.
- Compatibilidade transparente caso o avaliador prefira apontar para LocalStack ou AWS SQS real.

## Opções consideradas

1. **MiniStack (`ministackorg/ministack`) como serviço padrão no `docker-compose.yml` na porta `4566`, com
   endpoint configurável por variável de ambiente (`AWS_ENDPOINT_URL`)**
2. **LocalStack (`localstack/localstack`) exigindo `LOCALSTACK_AUTH_TOKEN` do avaliador**

## Decisão

Escolhemos a **Opção 1**: usamos `ministackorg/ministack` no `docker-compose.yml` exposto na porta `4566`. A
aplicação usa exclusivamente `@aws-sdk/client-sqs` parametrizado por `AWS_ENDPOINT_URL`, `AWS_REGION`,
`AWS_ACCESS_KEY_ID` e `AWS_SECRET_ACCESS_KEY`, funcionando de forma idêntica com MiniStack, LocalStack ou AWS
SQS real.

## Consequências

### Positivas

- `docker compose up` e os testes de integração/concorrência funcionam out-of-the-box em qualquer máquina ou CI
  sem cadastro nem chaves externas.
- Leve e rápido para subir nos testes de integração.

### Negativas / trade-offs

- Assim como no LocalStack, a semântica de deduplicação/ordenação de filas FIFO em emuladores locais pode ter
  diferenças sutis em relação à AWS — o que reforça a restrição 3 do desafio: **nunca confiar no SQS FIFO como
  garantia final de consistência; o PostgreSQL é a autoridade final**.

### Como validar

- Job de bootstrap no `docker-compose.yml` cria `wager-transactions-dlq.fifo`, `wager-transactions.fifo` (com
  `RedrivePolicy` apontando para a DLQ) e `wallet-events.fifo`, e `/health/ready` valida a existência das filas.

## Referências

- [RFC-0001 — Stack tecnológica, scaffolding hexagonal e topologia de execução](../rfc/RFC-0001-stack-scaffolding-e-topologia.md)
- Seção 4 e Seção 10 de [docs/challenge/CHALLENGE.md](../challenge/CHALLENGE.md)

