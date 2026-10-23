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

### 2.2 Regras para Branches de Feature (`feat/*`, `fix/*`)
- Desenvolvedores têm liberdade total para utilizar `git push --force-with-lease` durante o ciclo de desenvolvimento em sua própria branch para manter o histórico limpo via `rebase` e `squash`.

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

### Passo 4: Merge em `develop` e Deploy em Dev
Após aprovação do PR e passagem de todos os checks, o merge é feito para `develop`.
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
