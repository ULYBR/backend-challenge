---
status: Accepted
date: 2026-10-23
deciders: [Ulysses Andrade Leal]
---

# ADR-0025 — Auto-Merge do Dependabot para Atualizações Seguras sem Impacto em Fluxo

## Contexto e problema

O repositório possui o Dependabot configurado para monitorar vulnerabilidades (CVEs) e novas versões de dependências em quatro ecossistemas: NPM (`package.json`), GitHub Actions (`.github/workflows`), Terraform (`infra/terraform`) e Docker (`Dockerfile`).

No entanto, o processo de atualização apresenta dois riscos opostos:
1. **Sobrecarga de manutenção manual:** Atualizações triviais de tooling de desenvolvimento (`@biomejs/*`, `@types/*`, `typescript`) e actions de CI geram dezenas de PRs abertos que consomem tempo desnecessário de aprovação manual.
2. **Risco de regressão em fluxos de negócio financeiros:** Atualizações cegas em dependências de produção de runtime (`@nestjs/*`, `@mikro-orm/*`, `@aws-sdk/*`, `zod`) podem alterar silenciosamente comportamentos de frameworks, parsing de tipos monetários, semântica de locks ou validações de idempotência, violando invariantes financeiras críticas.

Precisamos de uma política declarativa que permita o Dependabot atualizar automaticamente o projeto de forma autônoma **apenas quando o update comprovadamente não afetar os fluxos de negócio do projeto**, exigindo revisão humana em caso contrário.

## Drivers da decisão

- **Segurança dos fluxos financeiros:** Garantir que nenhuma alteração em regras de concorrência, idempotência, ledger imutável ou contratos de API seja introduzida sem validação estrita.
- **Autonomia e eficiência:** Eliminar tarefas mecânicas de aprovação para pacotes de desenvolvimento, tipagem e CI.
- **Defesa em profundidade:** O auto-merge deve ser ativado apenas se **100% dos checks de CI** (testes unitários, testes de arquitetura, testes de schema e testes de concorrência com PostgreSQL e SQS reais) forem aprovados.
- **Governança no GitHub:** Utilizar recursos nativos do GitHub (`gh pr merge --auto --squash` e `dependabot/fetch-metadata@v2`) com permissões estritas de workflow.

## Opções consideradas

1. **Auto-merge indiscriminado para qualquer update não-major:**
   - *Prós:* Menor intervenção manual.
   - *Contras:* Atualizações minor de runtime (`direct:production`) podem introduzir quebras sutis em comportamentos de bibliotecas de persistência ou injeção de dependência.
2. **Revisão 100% manual de todos os PRs do Dependabot:**
   - *Prós:* Controle humano total.
   - *Contras:* Acúmulo de PRs abertos para dependências puramente de build/lint (`@types/*`, `@biomejs/*`).
3. **Classificação semântica de risco (Auto-Merge condicional a fluxos de negócio):**
   - *Prós:* Atualiza automaticamente o que não altera o fluxo (dev-dependencies, actions de CI, terraform seguro e patches retrocompatíveis de runtime após CI verde); bloqueia e solicita revisão humana para updates minor de produção e qualquer major.
   - *Contras:* Exige lógica de inspeção de metadados no workflow do GitHub Actions.

## Decisão

Escolhemos a **Opção 3 (Classificação semântica de risco)**.

A regra de aprovação e habilitação de auto-merge é estruturada da seguinte forma:

### 1. Atualizações elegíveis para Auto-Merge automático (Não afetam fluxos):
* **`devDependencies` (NPM):** `@biomejs/*`, `@types/*`, `typescript`, `@faker-js/*`, `bun-types` (`minor` e `patch`).
* **`github-actions`:** Workflows de CI e automação (`actions/*`, `docker/*`, etc. — `minor` e `patch`).
* **`terraform`:** Provedores de infraestrutura (`hashicorp/aws`, etc. — `minor` e `patch`).
* **`runtime-dependencies` (NPM) APENAS em `patch`:** Correções de bugs e patches de segurança retrocompatíveis (`semver-patch`), desde que a suíte completa de CI (PostgreSQL + SQS reais) aprove o build.

### 2. Atualizações que exigem Revisão Manual Humana (Podem afetar fluxos):
* **Qualquer atualização Major (`semver-major`):** Potencial de breaking change de API e contratos.
* **Atualizações Minor de dependências de produção (`direct:production`):** Podem conter alterações funcionais ou de comportamento interno em bibliotecas nucleares (`@nestjs/*`, `mikro-orm`, `@aws-sdk/*`, `zod`).

### 3. Configurações de Repositório no GitHub:
* Habilitado `allow_auto_merge: true` no repositório.
* Habilitado `can_approve_pull_request_reviews: true` e `default_workflow_permissions: write` para o runner do GitHub Actions, permitindo ao workflow aprovar PRs legítimos do bot.

## Consequências

### Positivas
- Tooling, linter, types e CI mantêm-se continuamente atualizados sem sobrecarga humana.
- Invariantes financeiras e fluxos de negócio do core banking permanecem 100% protegidos contra quebras não avaliadas.
- O merge automático só é executado pelo GitHub após a aprovação de todos os testes de integração e concorrência.

### Negativas / trade-offs
- PRs de dependências de runtime em versão minor precisarão de um clique de aprovação manual de um engenheiro após verificação dos fluxos.

## Como validar

- Execução do workflow `.github/workflows/dependabot-auto-merge.yaml` em novos PRs abertos pelo Dependabot.
- Verificação de que PRs de `devDependencies` recebem aprovação e auto-merge automático.
- Verificação de que PRs que violam as regras seguras recebem comentário alertando para revisão manual.

