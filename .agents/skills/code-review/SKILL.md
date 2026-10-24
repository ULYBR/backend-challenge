---
name: code-review
description: >-
  Executes an intelligent, multi-agent code review based on REVIEW.md guidelines. Orchestrates clean-context
  diff evaluation (zero-bias), web-researched industry benchmarking (Stripe, Fowler, PostgreSQL, OWASP),
  and a consensus synthesis with round capping and human risk escalation.
---

# Code Review Multi-Agente Inteligente

Esta skill orienta o processo de revisão de código seguindo as regras de ouro documentadas em [REVIEW.md](../../../REVIEW.md) e [AGENTS.md](../../../AGENTS.md).

## Quando usar esta skill

- Ao finalizar uma funcionalidade, refatoração ou correção de bug antes do merge.
- Ao receber a solicitação do usuário para revisar um Pull Request, branch ou diff específico.
- Para auditar conformidade com as regras financeiras, arquiteturais e de observabilidade do projeto.

---

## Passo a Passo da Execução

### Passo 1: Extrair o Diff e Contexto Mínimo
1. Obtenha o diff exato da alteração em relação à branch base:
   ```bash
   git diff origin/develop...HEAD
   ```
2. Identifique o RFC ou documento de especificação correspondente em `docs/rfc/` ou no enunciado do desafio (`docs/challenge/CHALLENGE.md`).
3. **Não compartilhe o histórico anterior de raciocínio ou chat:** o revisor deve avaliar exclusivamente o código resultante e sua especificação.

---

### Passo 2: Executar a Análise de Contexto Limpo (Agente 1)
Invoque ou assuma o papel de **Revisor de Contexto Limpo**:
- **Prompt:**
  > "Você é um auditor sênior de engenharia de software com contexto limpo. Analise exclusivamente o diff fornecido e o RFC correspondente. Avalie:
  > 1. A feature atende plenamente ao problema especificado sem introduzir regressões?
  > 2. Alguma invariante financeira foi violada (ponto flutuante, falta de lock pessimista por wallet, mutação em ledger, publicação fora da Outbox)?
  > 3. Foram seguidos os guardrails de código (zero comentários em .ts, imports com @, sem cadeias de else if, tipagem estrita sem any)?
  > 4. As falhas listadas na checklist de REVIEW.md estão ausentes?"

---

### Passo 3: Executar a Pesquisa de Mercado e Boas Práticas (Agente 2)
Invoque ou assuma o papel de **Revisor de Benchmark de Mercado**:
- Realize pesquisas na web (`search_web`) focando nos padrões adotados no diff:
  * Como sistemas financeiros de referência (Stripe, Adyen, Banco Central Pix, Martin Fowler PoEAA) resolvem esse cenário?
  * Existem *gotchas* conhecidos nas versões utilizadas das dependências (MikroORM, Bun, AWS SDK v3, PostgreSQL 17)?
  * A solução segue as recomendações do OWASP Top 10 e Well-Architected Framework?
- Compare a implementação com o estado da arte e liste se há abordagens mais simples, seguras ou modernas.

---

### Passo 4: Sintetizar o Consenso
O agente orquestrador cruza os relatórios do Agente 1 e do Agente 2:
1. **Pontos de Convergência:** O que ambos aprovaram ou ambos apontaram como risco.
2. **Pontos de Divergência:** Onde houve discordância técnica ou onde a pesquisa web revelou riscos não observados no código local.
3. **Classificação de Risco (Matriz de Risco):**
   - Se for alteração crítica (financeira, transacional, schema ou concorrência), a aprovação é **provisória** e exige validação humana explícita.
4. **Veredito:**
   - `APPROVE`: Código limpo, testes verdes, em conformidade com as invariantes e boas práticas.
   - `REQUEST_CHANGES`: Apontamentos claros com arquivo e linha para ajuste.
   - `ESCALATE_TO_HUMAN`: Atingiu 3 rodadas de revisão ou envolve decisão arquitetural de alto risco.

---

### Passo 5: Regra do Teto de Rodadas e Transformação de Erros
- **Teto:** No máximo 3 rodadas de apontamento $\rightarrow$ correção. Se na 3ª rodada ainda houver ressalvas, interrompa o ciclo e convoque o humano.
- **Aprendizado Contínuo:** Se uma não-conformidade foi apontada mais de uma vez:
  1. Crie um teste unitário estático em `test/unit/architecture.spec.ts`, ou
  2. Adicione uma regra no `biome.json` ou item no checklist de `REVIEW.md`.

