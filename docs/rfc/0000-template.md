---
rfc: RFC-NNNN
title: Título
status: Draft # Draft | In Review | Accepted | Implemented | Rejected | Withdrawn
author: nome
created: YYYY-MM-DD
updated: YYYY-MM-DD
phase: N # fase do docs/ROADMAP.md
adrs: [] # ADRs geradas a partir deste RFC
---

# RFC-NNNN — Título

## 1. Resumo

Um parágrafo: o que será construído e por quê.

## 2. Contexto e motivação

Requisitos do desafio cobertos (cite seções de `docs/challenge/CHALLENGE.md`) e o problema a resolver.

## 3. Objetivos e não-objetivos

**Objetivos**

- ...

**Não-objetivos**

- ...

## 4. Desenho proposto

Diagramas (mermaid), contratos, schemas, algoritmos e fluxos. Seja concreto o bastante para que outra pessoa
consiga implementar sem perguntar.

## 5. Invariantes e garantias

| Invariante | Onde é garantida (domínio / schema / infraestrutura) | Como é testada |
|---|---|---|
| ... | ... | ... |

## 6. Modos de falha

| Falha | Comportamento esperado | Teste |
|---|---|---|
| Processo morre antes do commit | ... | ... |
| Processo morre depois do commit e antes do ack | ... | ... |
| PostgreSQL indisponível | ... | ... |
| SQS indisponível | ... | ... |
| Mensagem duplicada / fora de ordem / concorrente | ... | ... |

## 7. Alternativas consideradas

Opções descartadas e por quê. Decisões relevantes viram ADRs (liste em `adrs`).

## 8. Observabilidade

Logs, métricas e alertas introduzidos por este RFC.

## 9. Plano de testes

- Unidade: ...
- Integração (infra real): ...
- Concorrência: ...

## 10. Plano de implementação

Passos pequenos e verificáveis, na ordem em que serão feitos.

- [ ] Passo 1
- [ ] Passo 2

## 11. Riscos e questões em aberto

- ...

