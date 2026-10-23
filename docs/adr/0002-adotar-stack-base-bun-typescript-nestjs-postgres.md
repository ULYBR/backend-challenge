---
status: Accepted
date: 2026-10-22
deciders: [Ulysses Andrade Leal]
rfc: RFC-0001
---

# ADR-0002 — Adotar a stack base Bun 1.x, TypeScript strict, NestJS 11, PostgreSQL 17, Zod e Biome

## Contexto e problema

A seção 4 do desafio define os componentes obrigatórios (Bun 1.x, TypeScript estrito, NestJS, PostgreSQL, AWS
SQS e Docker Compose), deixando em aberto a versão específica do Postgres e as bibliotecas de validação,
observabilidade e lint/formatação. Precisamos padronizar essas escolhas antes de iniciar o scaffolding.

## Drivers da decisão

- Conformidade total com a seção 4 do desafio.
- Segurança de tipos máxima em tempo de compilação (evitar `undefined` silencioso e coerções implícitas).
- Validação de contratos de entrada sem acoplar decorators ao modelo de domínio.
- Baixa fricção e velocidade de execução nos testes e no CI local.

## Opções consideradas

1. **Bun 1.x + TS strict + NestJS 11 + PostgreSQL 17 + Zod + Pino + prom-client + Biome**
2. **Bun 1.x + TS strict + NestJS 11 + PostgreSQL 16 + class-validator/class-transformer + ESLint/Prettier**

## Decisão

Escolhemos a **Opção 1**:

- **Bun 1.x** como runtime, gerenciador de pacotes e executor de testes (`bun test`).
- **TypeScript** com `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`,
  `noImplicitOverride: true` e `noFallthroughCasesInSwitch: true`.
- **NestJS 11** com `@Inject(...)` explícito nos construtores para não depender de `reflect-metadata` implícito.
- **PostgreSQL 17** (`postgres:17-alpine`) no Docker Compose.
- **Zod** em um `ZodValidationPipe` customizado na camada `interfaces/http` e no consumidor SQS.
- **Pino** (`nestjs-pino`), **prom-client** e **@nestjs/terminus** para logs, métricas e health checks.
- **Biome** como ferramenta única de lint e formatação.

## Consequências

### Positivas

- Schemas Zod inferem tipos estáticos diretamente e validam tanto payloads HTTP quanto mensagens SQS e variáveis
  de ambiente com a mesma sintaxe.
- Flags estritas de TypeScript capturam acessos fora de índice e propriedades opcionais mal atribuídas em tempo
  de compilação.
- Biome executa lint e format em milissegundos, sem dezenas de plugins de ESLint/Prettier.

### Negativas / trade-offs

- `exactOptionalPropertyTypes: true` exige distinção explícita entre propriedade omitida e `undefined`, o que
  requer atenção nos tipos de `State`/`Props` das entidades.
- Como Bun compila arquivos individualmente, decorators de parâmetro/tipo do NestJS exigem `@Inject(TOKEN)`
  explícito para robustez total.

### Como validar

- `bun run typecheck` (`tsc --noEmit`) e `bun run lint` (`biome check .`) executam sem erros.
- Teste de arquitetura verifica que `src/domain` não importa pacotes de infraestrutura ou validação.

## Prós e contras das opções

### Opção 1 — Zod + Biome + PG 17

- Bom, porque mantém DTOs livres de decorators e unifica validação HTTP, SQS e env.
- Ruim, porque não usa o `ValidationPipe` padrão de `class-validator` do NestJS (requer pipe próprio de ~25 linhas).

### Opção 2 — class-validator + ESLint/Prettier

- Bom, porque é o padrão tradicional dos tutoriais de NestJS.
- Ruim, porque `class-transformer` pode fazer coerções implícitas perigosas em valores monetários se mal configurado.

## Referências

- [RFC-0001 — Stack tecnológica, scaffolding hexagonal e topologia de execução](../rfc/RFC-0001-stack-scaffolding-e-topologia.md)

