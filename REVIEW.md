# REVIEW.md — Diretrizes de Revisão de Código e Governança Multi-Agente

Este documento define o processo oficial de Code Review para o repositório **Distributed Wagering Processor**.
Ele instrui tanto agentes de IA quanto revisores humanos sobre como avaliar Pull Requests e diffs de código com foco em **problemas reais, invariantes inegociáveis e boas práticas de mercado**.

---

## 1. O Mantra Central: "Se você mergeou, você é o dono"

> **"You merge it, you own it."**
> A velocidade de entrega só é sustentável com observabilidade profunda e capacidade de reversão (*rollback*) em minutos (< 5 minutos). 

Antes de aprovar e realizar o merge de qualquer alteração, garanta:
1. **Reversibilidade Garantida:** A alteração pode ser revertida de forma limpa? Migrations de banco de dados possuem script `down` testado e não causam perda destrutiva de dados históricos?
2. **Observabilidade Pronta no Deploy:** A alteração já nasce com logs estruturados (sem dados sensíveis) e métricas Prometheus para que qualquer anomalia seja detectada imediatamente?
3. **Runbook e Documentação:** Falhas operacionais decorrentes da mudança possuem passo a passo de mitigação em `docs/runbooks/`?

---

## 2. Matriz de Risco: Aprovação de Agente NÃO Substitui Humano

Agentes de IA são ferramentas de auditoria e análise de conformidade, mas **nunca substituem a responsabilidade humana** em partes críticas do sistema.

| Nível de Risco | Escopo / Módulos Afetados | Critério de Aprovação | Intervenção Humana |
| :--- | :--- | :--- | :--- |
| **Baixo** | Documentação Markdown (`docs/`), tipagens puramente documentais, ajustes cosméticos ou correções de texto. | 1 Agente de IA com contexto limpo pode validar. | Opcional (auto-merge permitido após CI verde). |
| **Médio** | Novos endpoints administrativos de leitura, refatorações internas sem alteração de schema SQL ou migrações cosméticas de dependências. | 2 Agentes (Funcional + Benchmark de Mercado) com parecer favorável unânime. | Humano notificado; merge via aprovação rápida. |
| **Crítico / Alto** | `Money`, `Wallet`, `WalletLedgerEntry`, concorrência (`FOR UPDATE`), migrations SQL (`up`/`down`), idempotência, Transactional Outbox, SQS Consumer. | 2 Agentes emitem parecer técnico detalhado + auditoria de conformidade. | **Obrigatória e Inegociável.** Nenhum agente pode autorizar merge em código financeiro sem sign-off humano. |

---

## 3. Workflow de Revisão Inteligente Multi-Agente

Para eliminar o **viés do agente que escreveu o código** (*prompt bias* e suposições da memória de contexto), revisões não devem ser feitas pelo mesmo agente que implementou a solução. 

O fluxo de revisão utiliza **três papéis especializados**:

```
                          ┌──────────────────────────┐
                          │   PR Diff + RFC/Issue    │
                          └─────────────┬────────────┘
                                        │
                 ┌──────────────────────┴──────────────────────┐
                 ▼                                             ▼
     ┌───────────────────────┐                     ┌───────────────────────┐
     │       Agente 1        │                     │       Agente 2        │
     │ Contexto Limpo (Zero) │                     │ Benchmark de Mercado  │
     │  Funcional / Invariante│                     │    (Pesquisa Web)     │
     └───────────┬───────────┘                     └───────────┬───────────┘
                 │                                             │
                 └──────────────────────┬──────────────────────┘
                                        ▼
                           ┌─────────────────────────┐
                           │   Árbitro de Consenso   │
                           │   (Síntese & Parecer)   │
                           └────────────┬────────────┘
                                        │
                   ┌────────────────────┴────────────────────┐
                   ▼                                         ▼
         [3 Rodadas Esgotadas]                       [Parecer Consolidado]
                   │                                         │
                   ▼                                         ▼
        Intervenção Humana                         Aprovação ou Ajuste
       (Anti-Loop Guardrail)                      (Conforme Matriz Risco)
```

### Papel 1: Revisor de Contexto Limpo (Clean-Context Reviewer)
* **Condição:** Instância nova, isolada, sem histórico de conversa do agente autor.
* **Entrada:** Exclusivamente o `git diff` e o documento de especificação (o RFC aceito em `docs/rfc/` ou a issue).
* **Foco da Análise:**
  * O código realmente cumpre os requisitos descritos no RFC?
  * Alguma das invariantes financeiras de `AGENTS.md` foi violada?
  * Existem efeitos colaterais silenciosos, estados não cobertos ou brechas de concorrência?
  * O código segue a regra de zero comentários em `.ts` e paths com `@`?

### Papel 2: Revisor de Mercado e Pesquisa Web (Market Benchmark Reviewer)
* **Condição:** Agente com capacidade de busca ativa na web (`search_web`).
* **Foco da Análise:**
  * Pesquisar e comparar a implementação contra o estado da arte e padrões consagrados (Stripe, Martin Fowler, PostgreSQL Docs, AWS Well-Architected, OWASP API Security).
  * Verificar se há vulnerabilidades conhecidas, *gotchas* de concorrência na versão das bibliotecas usadas (ex.: MikroORM, Bun, AWS SDK v3) ou alternativas arquiteturais mais simples e robustas.
  * Identificar se a abordagem é moderna ou se está introduzindo um anti-padrão de mercado.

### Papel 3: Árbitro de Consenso (Consensus Arbiter)
* **Foco da Análise:**
  * Cruza os apontamentos do Agente 1 (Funcional) e do Agente 2 (Mercado).
  * Destaca:
    1. **Consensos:** Pontos em que ambos concordam que há falha ou risco.
    2. **Divergências:** Onde o Agente 1 apontou conformidade mas o Agente 2 encontrou riscos de mercado (ou vice-versa).
    3. **Veredito:** `APPROVE`, `REQUEST_CHANGES` ou `ESCALATE_TO_HUMAN`.

---

## 4. Teto de Rodadas (Anti-Loop Guardrail)

Para evitar loops infinitos onde o agente sugere correções pontuais, outro agente corrige introduzindo novos detalhes cosméticos e a revisão nunca termina:

1. **Limite Máximo:** **3 rodadas** de correção e re-revisão.
2. **Atingiu a 3ª Rodada?**
   * O agente revisor **deve parar imediatamente** de sugerir novas rodadas de ajuste automatizado.
   * Emite um relatório sintético das divergências remanescentes e invoca a **intervenção humana**.
   * O humano decide se aceita o código como está, orienta uma redefinição de abordagem ou assume o commit.

---

## 5. Transformando Erros Recorrentes em Regras

Se um erro ou não-conformidade for apontado **mais de uma vez** durante revisões:
1. **Não apenas corrija o código pontual.**
2. É mandatório transformar a falha em um mecanismo preventivo automático:
   * **Se for regra de código/arquitetura:** Adicionar um teste unitário estático em `test/unit/architecture.spec.ts` (ex.: proibição de imports relativos, ausência de comentários, proibição de tipos `any`).
   * **Se for regra de estilo/linter:** Adicionar ou reforçar regra no `biome.json`.
   * **Se for invariante de negócio ou desenho:** Adicionar um item explícito na lista de checagem deste `REVIEW.md` e em `AGENTS.md`.

---

## 6. Colinha de Características de Falhas (Failure Modes Checklist)

Ao revisar qualquer alteração neste repositório, utilize esta lista como guia rápido de verificação. A presença de qualquer item abaixo caracteriza **falha grave**:

### 🚨 Invariantes Financeiras e Integridade (FALHA ELIMINATÓRIA)
- [ ] **Uso de ponto flutuante:** Qualquer uso de `number`, `float` ou `double` para representar dinheiro ou saldo (deve usar `Money` com `bigint` em centavos no domínio, `NUMERIC(19, 2)` no banco e `string` decimal nos contratos).
- [ ] **Mutação no Ledger:** Qualquer instrução `UPDATE` ou `DELETE` na tabela `wallet_ledger_entries` (o ledger é estritamente *append-only*).
- [ ] **Cálculo de saldo sem Lock:** Fazer `read → calculate → update` de saldo sem lock pessimista prévio (`SELECT ... FOR UPDATE` filtrando por `walletId`).
- [ ] **Lock Global:** Uso de locks na tabela inteira ou travas em múltiplas carteiras simultâneas que quebrem a escalabilidade horizontal.
- [ ] **Invariante Aritmética ausente:** Falta de validação de balanço contábil (`balanceBefore ± money === balanceAfter`).

### ⚡ Concorrência, Idempotência e Mensageria
- [ ] **Idempotência baseada em cache:** Confiar em Redis ou memória volátil para deduplicação (a garantia é a constraint `UNIQUE` no PostgreSQL).
- [ ] **Hash não-canônico:** Cálculo de hash de payload sem ordenação recursiva de chaves ou sem normalização de casas decimais de `amount`.
- [ ] **Publicação fora da Outbox:** Chamada direta a `sqsClient.send(SendMessageCommand)` antes do commit SQL da transação de negócio (deve salvar na tabela `outbox_messages` na mesma transação ACID).
- [ ] **Worker de Outbox guloso:** Polling de Outbox sem `FOR UPDATE SKIP LOCKED`, causando contenção ou locks duplicados entre instâncias.
- [ ] **Dependência de FIFO do SQS:** Confiar cegamente nas garantias de ordenação do SQS em vez de validar idempotência e predecessores no banco.

### 🌐 Configurações, Dependências e Ambiente
- [ ] **Exigência de Token LocalStack:** Configuração padrão do SQS que exija `LOCALSTACK_AUTH_TOKEN` para boot (o projeto usa MiniStack como padrão zero-auth; LocalStack é opcional via profile).
- [ ] **Portas ou URLs hardcoded:** Endpoints de banco ou SQS fixos sem usar variáveis de ambiente parametrizadas via `src/infrastructure/config/env.ts`.

### 🛡️ Observabilidade e Segurança
- [ ] **Vazamento de dados financeiros em logs:** Qualquer log que imprima payloads com `money`, `balance`, `amount`, `initialBalance`, tokens ou credenciais.
- [ ] **Ausência de Correlation ID:** Operações de fila ou requisições HTTP sem propagação de contexto via `AsyncLocalStorage`.
- [ ] **Vazamento de abstração interna na documentação pública:** Expor tabelas SQL, queries ou nomes de workers internos na especificação pública do ReDoc.

### 📐 Arquitetura Hexagonal e Código
- [ ] **Vazamento de camadas:** Camada de domínio (`src/domain/`) importando NestJS, MikroORM, AWS SDK, Zod ou camadas externas.
- [ ] **Modelo de Domínio Anêmico (Tactical DDD):** Entidades com setters públicos ou sem métodos semânticos encapsulando transições e validações de invariantes.
- [ ] **Comentários em arquivos `.ts`:** Qualquer comentário inline ou de bloco em código TypeScript (código deve ser autoexplicativo).
- [ ] **Imports relativos:** Uso de `./` ou `../` em `src/` ou `test/` (obrigatório usar `@domain/*`, `@application/*`, etc.).
- [ ] **Encadeamento de `if / else if`:** Uso de cadeias condicionais longas em vez de Strategy Maps / Lookup Tables declarativas.
- [ ] **Burocracia desnecessária (Auto-Sizing):** Criar RFC completo para tarefas triviais ou bugfixes pontuais (deve usar a trilha `Lean Track` com mini-spec EARS).

### 🧪 Qualidade de Testes e Prevenção de Regressão (TESTING.md)
- [ ] **Testes tautológicos ou fracos:** Testes que mockam a si mesmos ou usam apenas `expect(x).toBeDefined()` sem validar estado exato.
- [ ] **Mocks em integração:** Uso de mocks para PostgreSQL ou SQS em `test/integration/` ou `test/concurrency/` (deve usar containers reais).
- [ ] **Correção de bug sem teste de regressão prévio:** Corrigir bug silencioso sem antes criar o teste que falha comprovando o problema (`RED` $\rightarrow$ `GREEN` $\rightarrow$ `GUARD`).
- [ ] **Invariante contábil ausente:** Teste de integração financeiro que não valida ao final se `wallet.balance == saldo reconstruído pelo ledger`.
- [ ] **Prolixidade e ruído:** Dezenas de linhas de setup duplicadas em vez de utilizar builders/fixtures em `test/fixtures/` ou `test/helpers/`.

