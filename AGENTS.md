# AGENTS.md — Regras do projeto

Regras sempre ativas para qualquer agente ou pessoa que trabalhar neste repositório.
Enunciado: [docs/challenge/CHALLENGE.md](docs/challenge/CHALLENGE.md). Plano: [docs/ROADMAP.md](docs/ROADMAP.md).

## Idioma

- **Código, identificadores, nomes de tabelas/colunas, mensagens de commit, logs e métricas: inglês.**
- **Documentação (RFC, ADR, ARCHITECTURE.md, README.md, runbooks): PT-BR.**

## Processo (docs-first com Auto-Sizing)

1. **Auto-Sizing de Desenvolvimento (Dual-Track)**:
   - **Full Track (Features, Schemas, Concorrência e Mensageria)**: Requer obrigatoriamente um **RFC** em `docs/rfc/` com status `Accepted` (use a skill `write-rfc`) e **ADRs** para decisões arquiteturais relevantes (use a skill `write-adr`).
   - **Lean Track (Bugfixes, Refatorações e Ajustes Pontuais)**: Dispensa criação de arquivo RFC. O agente deve apenas especificar a regra em formato EARS no PR/commit e seguir o protocolo `Red → Green → Guard` do [TESTING.md](TESTING.md).
2. Toda decisão arquitetural relevante vira uma **ADR** em `docs/adr/` (use a skill `write-adr`). ADR aceita não é editada: é substituída por outra (`Superseded by`).
3. Ao fim de cada step: atualizar `docs/ROADMAP.md` e `ARCHITECTURE.md`.
4. Migrations seguem a skill `db-migration`: SQL explícito, `up` e `down`, e teste para cada constraint.
5. Toda documentação de API segue a skill `document-api`: OpenAPI 3.0.3, segregação pública/privada com **information hiding** (documentação pública é estritamente black-box e nunca vaza queries SQL, nomes de tabelas ou workers internos), diagramas de fluxo de negócio em ASCII/Unicode e cobertura exaustiva de respostas (200, 201, 202, 400, 404, 409, 422, 429, 503).
6. Toda revisão de código segue as diretrizes em [REVIEW.md](REVIEW.md) e a skill `code-review`: revisão multi-agente com contexto limpo, benchmark de mercado na web, teto de 3 rodadas de revisão e aprovação humana obrigatória para código financeiro e transacional ("You merge it, you own it"). Erros recorrentes devem ser transformados em regras automatizadas em `test/unit/architecture.spec.ts`.

## Invariantes financeiras (violação = falha eliminatória)

- **Nunca** usar `number`, `float` ou `double` para dinheiro. Domínio usa `Money` (`bigint` em unidades menores, escala 2); banco usa `NUMERIC(19,2)`; contratos usam string decimal.
- **Nunca** usar cache em memória como garantia de idempotência. A garantia é a unique constraint no PostgreSQL.
- **Nunca** publicar evento fora da Transactional Outbox, nem antes do commit.
- **Nunca** fazer `UPDATE` ou `DELETE` em `wallet_ledger_entries`. O ledger é append-only.
- **Nunca** usar lock global. A unidade de concorrência é a `walletId` (`SELECT ... FOR UPDATE` na wallet).
- **Nunca** fazer `read → calculate → update` de saldo sem lock da wallet.
- Inbox, transação, saldo, ledger e outbox participam da **mesma transação SQL**.
- Unicidade, imutabilidade e não-negatividade são garantidas **no schema** (constraints, FKs compostas, triggers), não só no código.
- Recursos de FIFO/dedup do SQS são otimização, nunca a garantia final.

## Arquitetura e estilo de código

- Hexagonal: `src/domain` → `src/application` → `src/infrastructure` / `src/interfaces`. Dependências só apontam para dentro.
- `src/domain` não importa NestJS, MikroORM, AWS SDK nem Zod.
- **Padrão de Imports com Path Alias (`@`)**:
  - Proibido usar imports relativos (`./` ou `../`) em `src/` e `test/`.
  - Todo import interno deve usar os path aliases configurados no `tsconfig.json`: `@domain/*`, `@application/*`, `@infrastructure/*`, `@interfaces/*`, `@src/*` e `@test/*`.
- **Zero comentários em código TypeScript (`.ts`)**:
  - Proibido deixar comentários explicativos ou divisórias em arquivos `.ts`. O código deve ser autoexplicativo por meio de nomes semânticos de tipos, variáveis e métodos. Documentação fica nos arquivos Markdown (`docs/`, `RFC`, `ADR`, `ARCHITECTURE.md`).
- **Padrão de Types e Contratos (Input / Output / State / DTO)**:
  - Tipos e contratos ficam isolados em arquivos dedicados (`*.types.ts` no domínio e infraestrutura; `*.dto.ts` na aplicação e interfaces).
  - Todo fluxo define explicitamente seu **contrato de entrada** e **contrato de saída**:
    - Domínio: `*Input` / `*Props` (entrada de factory), `*State` (estado interno/reidratação) e `*Output` / `*Dto` (saída serializada).
    - Aplicação (Use Cases): `<UseCase>InputDto` (entrada) e `<UseCase>OutputDto` (saída).
    - Interfaces (HTTP / SQS): `<Endpoint>RequestDto` (entrada) e `<Endpoint>ResponseDto` (saída).
- **Padrão de `class constructor`**:
  - **Domínio (Entidades, Aggregates, Value Objects, Eventos)**: construtor sempre `private` ou `protected` recebendo um único objeto de estado tipado (`state: <Entity>State` ou `props: <Type>Props`), sem listas longas de parâmetros posicionais e sem lógica condicional no construtor + factories estáticas semânticas (`create`, `from`, `zero`, `open`, `receive`, `enqueue`, `rehydrate`). `rehydrate` apenas reconstrói estado já persistido, sem revalidar transições.
  - **Aplicação / Infra / Interfaces**: construtor usado exclusivamente para injeção de dependências (`private readonly`), sem efeitos colaterais no construtor.
- **Evitar `if / else` — preferir despacho declarativo e polimorfismo**:
  - **Proibido** encadear `if / else if / switch` para regras por tipo (`WagerTransactionKind`), máquina de estados (`WagerTransactionStatus`), classificação de erros, mapeamento de status HTTP ou comandos CLI.
  - Use **Lookup Tables / Strategy Maps (`Record<Key, Policy | Handler>`)**, polimorfismo ou composição funcional.
  - Use `if` **apenas** quando estritamente necessário como *guard clause* de falha rápida encapsulada em métodos privados descritivos (`assertSameCurrency`, `assertCanTransitionTo`, `assertBalanced`).
- **Padrão de Logs Estruturados**:
  - Sempre JSON estruturado via porta/serviço de log com `event` semântico em `dot.case` (ex.: `wager.transaction.processed`, `wallet.opened`, `outbox.event.published`).
  - Contexto de rastreamento propagado via `AsyncLocalStorage`: `correlationId`, `messageId`, `transactionId`, `walletId`, `providerId`, `instanceId`.
  - **Nunca** logar payloads financeiros completos (`money`, `balance`, `amount`) nem credenciais/tokens.
- **Tactical DDD (Combate a Modelos Anêmicos)**:
  - Proibido criar entidades anêmicas (meros portadores de dados com getters/setters e lógica espalhada em Use Cases).
  - Entidades nunca expõem setters públicos.
  - Toda mutação de estado ocorre por meio de métodos de negócio semânticos (`debit(...)`, `credit(...)`, `markAsProcessed(...)`) que validam suas próprias invariantes e transições internamente.
- Estado encapsulado (campos privados + getters); transições explícitas; estados terminais lançam `InvalidTransactionStateError`.
- TypeScript strict, sem `any`, sem non-null assertion (`!`) em código de produção.
- Erros de domínio carregam `failureCode` estável (taxonomia em ADR).

## Testes

- Diretrizes completas em [TESTING.md](TESTING.md): alta densidade de sinal, zero testes tautológicos/inócuos e proibição de mocks de banco/fila em testes de integração.
- **Protocolo de Bug Silencioso e Regressão**: antes de corrigir qualquer bug reportado, crie obrigatoriamente um teste que reproduza a falha (`RED`); aplique o fix mínimo (`GREEN`); e promova o teste a sentinela permanente (`GUARD`).
- Testes de integração e concorrência usam **PostgreSQL e SQS reais** (containers). Mocks de banco/fila são proibidos nesses níveis.
- Todo teste de integração/concorrência termina verificando: `wallet.balance == saldo reconstruído pelo ledger`.
- Concorrência é testada com paralelismo real (múltiplas conexões/processos), não com chamadas sequenciais.

