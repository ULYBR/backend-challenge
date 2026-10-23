---
name: write-adr
description: >-
  Use this skill when an architectural decision must be recorded in this repository (choice of library,
  concurrency strategy, schema guarantee, error taxonomy, retry policy, etc.) or when an existing ADR must
  be superseded. Produces a MADR-formatted file in docs/adr/ in PT-BR and updates the ADR index.
---

# Escrever uma ADR

## Passos

1. Descubra o próximo número:
   `bun .agents/skills/write-adr/scripts/next-number.ts adr` (ou `ls docs/adr` e some 1 ao maior `NNNN`).
2. Copie [docs/adr/0000-template.md](../../../docs/adr/0000-template.md) para
   `docs/adr/NNNN-titulo-em-kebab-case.md` (título em PT-BR, sem acentos no nome do arquivo).
3. Preencha:
   - **Título no imperativo** e focado em uma única decisão.
   - **Contexto**: cite a seção do desafio (`docs/challenge/CHALLENGE.md`) e o RFC de origem.
   - **Opções consideradas**: no mínimo 2 opções reais, com prós e contras honestos.
   - **Consequências negativas**: obrigatório; toda decisão tem custo.
   - **Como validar**: teste, constraint ou métrica que comprova a decisão.
4. Adicione a linha na tabela de [docs/adr/README.md](../../../docs/adr/README.md).
5. Se a ADR veio de um RFC, adicione o número no campo `adrs` do front matter do RFC.
6. Para mudar uma decisão aceita: **não edite**; crie uma nova ADR e altere apenas o `status` da antiga para
   `Superseded by ADR-NNNN`.

## Validação

- O arquivo tem front matter com `status`, `date`, `deciders`, `rfc`.
- A seção "Como validar" aponta para algo executável (teste/constraint/métrica).
- O índice `docs/adr/README.md` lista a ADR.

