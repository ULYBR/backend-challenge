---
status: Accepted
date: 2026-10-22
deciders: [Ulysses Andrade Leal]
rfc: —
---

# ADR-0001 — Registrar decisões arquiteturais com ADRs (MADR) e desenhos com RFCs

## Contexto e problema

O desafio avalia explicitamente a **clareza das decisões técnicas** (seção 1) e exige um `ARCHITECTURE.md` com
decisões, trade-offs e limitações (seção 14). Várias escolhas são deixadas ao candidato: ORM, estratégia de
concorrência, taxonomia de falhas, mapeamento HTTP, política de backoff, autenticação. Sem um registro, o
raciocínio se perde e o `ARCHITECTURE.md` vira uma reconstrução tardia.

## Drivers da decisão

- Rastreabilidade: cada decisão ligada ao requisito que a motivou.
- Revisão antes da implementação (docs-first), reduzindo retrabalho.
- Facilidade de apresentar e defender as escolhas na entrevista.

## Opções consideradas

1. Só `ARCHITECTURE.md`, escrito no final.
2. ADRs no formato MADR + RFCs por fase.
3. Wiki/ferramenta externa.

## Decisão

Escolhemos a **opção 2**:

- **RFC** (`docs/rfc/RFC-NNNN-*.md`): proposta de desenho de uma fase inteira, escrita **antes** do código.
  Ciclo: `Draft → In Review → Accepted → Implemented`.
- **ADR** (`docs/adr/NNNN-*.md`, formato [MADR](https://adr.github.io/madr/)): uma decisão por arquivo,
  curta e imutável depois de aceita. Mudanças de rumo criam uma nova ADR que marca a anterior como
  `Superseded by ADR-NNNN`.
- **ARCHITECTURE.md**: visão consolidada, que aponta para as ADRs e é atualizada ao fim de cada fase.
- Docs em PT-BR; código e identificadores em inglês.

## Consequências

### Positivas

- Cada decisão fica com contexto, alternativas e consequências registrados junto ao código, versionados no Git.
- O `ARCHITECTURE.md` final é um índice das decisões, não um texto escrito do zero.

### Negativas / trade-offs

- Custo de escrita por fase. Mitigação: templates (`0000-template.md`) e as skills `write-adr` e `write-rfc`.

### Como validar

- Toda fase do `docs/ROADMAP.md` aponta para um RFC e para suas ADRs.
- PRs que introduzem uma decisão arquitetural incluem a ADR correspondente.

## Referências

- Michael Nygard, *Documenting Architecture Decisions* (2011).
- MADR — Markdown Architectural Decision Records: https://adr.github.io/madr/

