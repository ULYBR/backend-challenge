---
name: write-rfc
description: >-
  Use this skill before starting any phase from docs/ROADMAP.md, or when a design proposal is needed for a
  non-trivial change (new flow, schema change, messaging or concurrency behavior). Produces an RFC in
  docs/rfc/ in PT-BR covering invariants, failure modes and test plan.
---

# Escrever um RFC

## Passos

1. Número: `bun .agents/skills/write-adr/scripts/next-number.ts rfc`.
2. Copie [docs/rfc/0000-template.md](../../../docs/rfc/0000-template.md) para `docs/rfc/RFC-NNNN-titulo.md`.
3. Releia as seções relevantes de `docs/challenge/CHALLENGE.md` e o `AGENTS.md`, e cite as seções no item 2.
4. Preencha **todas** as seções. Checklist obrigatório:
   - [ ] Tabela de **invariantes** dizendo onde cada uma é garantida (domínio, schema ou infra) e como é testada.
   - [ ] Tabela de **modos de falha**: crash antes/depois do commit, crash antes do ack, PostgreSQL/SQS fora,
         mensagem duplicada, fora de ordem, concorrente.
   - [ ] Diagramas mermaid para fluxos não triviais (sequência para pipelines, estados para máquinas de estado,
         ER para schema).
   - [ ] Alternativas descartadas, com o motivo. Cada decisão relevante listada em `adrs` vira uma ADR
         (skill `write-adr`).
   - [ ] Métricas e logs introduzidos.
   - [ ] Plano de testes dividido em unidade / integração (infra real) / concorrência.
   - [ ] Plano de implementação em passos pequenos com checkbox.
5. Registre na tabela de [docs/rfc/README.md](../../../docs/rfc/README.md) e na fase de
   [docs/ROADMAP.md](../../../docs/ROADMAP.md).
6. Status inicial `Draft`. Apresente ao usuário para revisão; só mude para `Accepted` com aprovação explícita.
7. Ao concluir a fase: status `Implemented`, marque os checkboxes e atualize `ARCHITECTURE.md`.

## Validação

- Nenhuma seção do template ficou com placeholder.
- Toda invariante citada tem um teste correspondente no plano de testes.

