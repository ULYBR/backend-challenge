# Governança de Branches & Proteção de Repositório (Branch Protection & GitOps)

Este documento estabelece o modelo de branching, regras de proteção e fluxo de promoção contínua para o repositório **Distributed Wagering Processor**, refletindo o padrão de engenharia de plataformas financeiras de missão crítica.

---

## 1. Topologia de Branches

```
      (Feature Branch)
      feat/ticket-123  ─────────┐ (PR)
                                ▼
(Dev / Staging)  develop ───────┴───────────────────────────────► [Deploy Dev via ArgoCD]
                                                 │
                                                 │ (Release PR)
                                                 ▼
(Production)     main ───────────────────────────┴──────────────► [Deploy Prod via ArgoCD + Cosign]
```

| Branch | Finalidade | Deploy Automático | Proteção de Branch |
|---|---|---|---|
| **`main`** | Código em Produção | **Produção** (`values-prod.yaml` / namespace `wagering`) | **Protegida (Crítica)** |
| **`develop`** | Integração contínua e Staging | **Desenvolvimento** (`values-dev.yaml` / namespace `wagering-dev`) | **Protegida (Estrita)** |
| **`feat/*`**, **`fix/*`** | Desenvolvimento de features e correções | Apenas execução da esteira de CI (Testes/Lint) | Efêmera (Permite rebase/force-push) |

---

## 2. Regras de Proteção de Branch (GitHub Rulesets)

Para configurar no GitHub: **Settings $\rightarrow$ Rules $\rightarrow$ Rulesets $\rightarrow$ New ruleset**.

### 2.1 Regras para `main` e `develop`
1. **Bloquear Commits Diretos**:
   - É proibido realizar `git push origin main` ou `git push origin develop` diretamente.
   - Qualquer alteração deve obrigatoriamente passar por um **Pull Request**.
2. **Bloquear Force Push (`Block force pushes / non-fast-forward`)**:
   - `main` e `develop` não aceitam `--force` sob nenhuma circunstância, garantindo histórico linear e auditabilidade contábil.
3. **Bloquear Exclusão de Branch (`Block branch deletions`)**:
   - Impede que `main` ou `develop` sejam deletadas por acidente.
4. **Exigir Assinatura Criptográfica de Commits (`Require signed commits`)**:
   - Todo commit deve ser assinado digitalmente com chave **GPG** ou **SSH** vinculada à conta do desenvolvedor.
5. **Requisitos de Aprovação de PR (`Require a pull request before merging`)**:
   - Mínimo de **1 aprovação** de revisão de código.
   - *Dismiss stale pull request approvals when new commits are pushed*: Novas alterações invalidam aprovações anteriores.
   - *Require conversation resolution*: Todas as threads de discussão do PR devem ser marcadas como resolvidas.
6. **Status Checks Obrigatórios (`Require status checks to pass`)**:
   O botão de merge fica bloqueado até que todos os jobs da esteira passem com sucesso:
   - `Commit Signature & Secret Leak Audit`
   - `Quality, Strict Typing & IaC Validation`
   - `Test Pyramid (Unit, Integration, E2E & 8 Concurrency Scenarios)`
   - `Supply Chain Security (Trivy & SBOM)`
7. **Estratégia Padrão e Obrigatória de Merge: Squash and Merge**:
   - É proibido utilizar *Merge Commit tradicional* para PRs de desenvolvimento (`feat/*`, `fix/*`, `chore/*` e Dependabot).
   - Todos os PRs devem obrigatoriamente utilizar **Squash and Merge**.
   - Benefícios contábeis e de engenharia:
     - **Histórico 100% Linear e Limpo**: Elimina grafos paralelos ("train tracks") e commits intermediários de rascunho (`wip`, `ajuste de review`, `typo`).
     - **Atomicidade e Reversibilidade**: Cada funcionalidade ou correção vira exatamente 1 commit semântico rastreável no `git log`. Facilita operações de `git revert` atômico e `git bisect` sem efeitos colaterais.
     - **Conformidade de Assinatura**: O commit final gerado pelo GitHub no squash é automaticamente assinado e auditável.

### 2.2 Configuração Recomendada no Repositório GitHub
Em **Settings $\rightarrow$ General $\rightarrow$ Pull Requests**:
- [x] **Allow squash merging**: Habilitado e configurado como padrão único.
  - *Default commit message*: `Pull request title and description`.
- [ ] **Allow merge commits**: Desmarcado (evita histórico poluído).
- [ ] **Allow rebase merging**: Desmarcado (ou restrito a sincronizações internas).
- [x] **Allow auto-merge**: Marcado (habilita o auto-merge assíncrono).
- [x] **Automatically delete head branches**: Marcado (deleta branches efêmeras após o merge).

### 2.3 Regras para Branches de Feature (`feat/*`, `fix/*`)
- Desenvolvedores têm liberdade total para utilizar `git push --force-with-lease` durante o ciclo de desenvolvimento em sua própria branch para manter o histórico limpo via `rebase` e `squash`.

### 2.4 Automação Assíncrona de Dependências (Dependabot Auto-Merge)
Para manter o ecossistema continuamente seguro sem sobrecarregar a engenharia com revisões manuais repetitivas, implementa-se o workflow [dependabot-auto-merge.yaml](.github/workflows/dependabot-auto-merge.yaml):
- **Atualizações Patch & Minor**: Aprovadas e agendadas para auto-merge (`gh pr merge --auto --squash`) automaticamente via GitHub Actions. O merge efetivo só ocorre após 100% dos checks de CI (testes de concorrência, tipo estrito, segurança Trivy e Gitleaks) passarem com sucesso.
- **Atualizações Major (Breaking Changes)**: Requerem revisão manual, aprovação humana e testes locais antes do merge.
- **Configurações necessárias no GitHub**:
  - `Settings -> General -> Pull Requests`: Marcar **Allow auto-merge**.
  - `Settings -> Actions -> General -> Workflow permissions`: Marcar **Allow GitHub Actions to create and approve pull requests**.

---

## 3. Fluxo de Trabalho do Desenvolvedor (Passo a Passo)

### Passo 1: Iniciar uma nova funcionalidade
```bash
git checkout develop
git pull origin develop
git checkout -b feat/wager-pipeline-enhancement
```

### Passo 2: Desenvolver e assinar commits
```bash
# Commits assinados com chave GPG (-S)
git commit -S -m "feat(wagering): implement new provider reconciliation adapter"
```

### Passo 3: Submeter para revisão
```bash
git push -u origin feat/wager-pipeline-enhancement
```
Abra um **Pull Request apontando para `develop`**. A esteira de CI será disparada automaticamente no GitHub Actions, validando:
- Lint e Formatação com Biome
- Compilação estrita do TypeScript
- Pirâmide de testes (Unitários, Integração no PostgreSQL 17 + SQS, E2E e Concorrência com 3 nós)
- Varredura de vulnerabilidades Trivy e auditoria Gitleaks

### Passo 4: Merge em `develop` (via Squash) e Deploy em Dev
Após aprovação do PR e passagem de todos os checks, o merge é realizado **obrigatoriamente via Squash and Merge** para `develop`.
- O GitHub comprime todos os commits do PR em 1 commit semântico linear.
- O GitHub Actions compila o container com a tag `dev-${SHA}`.
- O manifesto `infra/helm/distributed-wagering-processor/values-dev.yaml` é atualizado.
- O ArgoCD detecta a alteração e atualiza os Pods no namespace `wagering-dev`.

### Passo 5: Release para Produção (`main`)
Quando a versão estiver validada em ambiente de desenvolvimento/staging:
1. Cria-se um **Release PR** de `develop` para `main`.
2. Após aprovação, o merge para `main` é concluído.
3. O GitHub Actions:
   - Constrói a imagem oficial com tag `prod-${SHA}`.
   - Assina digitalmente o container com **Cosign (Sigstore)** via OIDC keyless.
   - Atualiza `values-prod.yaml`.
   - O ArgoCD realiza o rollout progressivo e seguro em **Produção**.
