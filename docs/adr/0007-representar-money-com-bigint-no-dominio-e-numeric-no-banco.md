---
status: Accepted
date: 2026-10-22
deciders: [Ulysses Andrade Leal]
rfc: RFC-0002
---

# ADR-0007 — Representar Money com bigint em unidades menores no domínio e NUMERIC(19,2) no PostgreSQL

## Contexto e problema

A seção 5 (restrição 1) e a seção 6.1 do desafio proíbem de forma eliminatória o uso de `number`, `float` ou
`double` para valores monetários. O Value Object `Money` deve ser imutável, operar com escala fixa de 2 casas
decimais, serializar `amount` como string decimal (ex.: `"25.00"`), rejeitar entradas inválidas (`NaN`,
`Infinity`, notação científica, string vazia, mais de 2 casas decimais, negativos nos contratos de entrada) e não
depender de tipos do ORM.

## Drivers da decisão

- Correção aritmética absoluta (zero erro de representação binária IEEE 754).
- Zero dependência externa no núcleo de domínio (`src/domain`).
- Persistência legível, auditável e com `CHECK` constraints aritméticas diretas no PostgreSQL.
- Normalização consistente de entradas com 0 a 2 casas decimais (`"25"` → `"25.00"`, `"25.5"` → `"25.50"`),
  conforme decisão D3 do [ROADMAP](../ROADMAP.md).

## Opções consideradas

1. **Domínio com `bigint` em unidades menores (`minorUnits`, escala $10^2$) + Banco com `NUMERIC(19, 2)` +
   Contratos com string decimal normalizada (`"25.00"`)**
2. **Biblioteca externa (`decimal.js` ou `big.js`) no domínio + `NUMERIC(19, 2)` no banco**
3. **`BIGINT` em centavos também nas colunas do PostgreSQL**

## Decisão

Escolhemos a **Opção 1**:

- Internamente, `Money` armazena `private readonly minorUnits: bigint` (onde `"25.00"` equivale a `2500n`) e
  `public readonly currency: string` (validado contra `/^[A-Z]{3}$/`).
- O parser de `Money.from({ amount, currency })` valida a string com regex estrita
  `/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/` (ou com sinal negativo apenas via métodos internos de domínio, nunca em
  contratos de entrada), rejeitando espaços, sinal `+`, zeros à esquerda (`"00"`, `"01.00"`), notação científica
  (`"1e2"`), mais de 2 casas decimais (`"1.999"`), `NaN` e `Infinity`.
- A serialização `toString()` / `toJSON().amount` formata sempre com 2 casas decimais exatas (`"25.00"`), e o
  `payloadHash` canônico é calculado sobre o valor já normalizado.
- No PostgreSQL, todas as colunas monetárias (`balance`, `amount`, `balance_before`, `balance_after`,
  `recorded_balance`) usam `NUMERIC(19, 2)`, que o driver `pg` retorna como `string`, preservando a precisão na
  reidratação (`Money.from({ amount: row.amount, currency: row.currency })`).

## Consequências

### Positivas

- Operações `add`, `subtract`, `negate`, `equals` e `isLessThan` em `bigint` são nativas da linguagem, exatas e
  livres de alocação de objetos intermediários pesados.
- Consultas SQL, relatórios de reconciliação (`SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END)`)
  e `CHECK` constraints no PostgreSQL operam diretamente sobre valores decimais legíveis (`1000.00`).

### Negativas / trade-offs

- Escala fixa de 2 casas decimais no parser/formatador (adequado aos requisitos explícitos da seção 6.1 do
  desafio).

### Como validar

- Suíte de unidade `test/unit/domain/money.spec.ts` testando soma, subtração, casos clássicos de ponto flutuante
  (`"0.10" + "0.20" === "0.30"`), normalização (`"25" -> "25.00"`), conflito de moeda e todas as entradas
  inválidas.

## Referências

- [RFC-0002 — Modelagem de dados, design de relacionamentos e invariantes no schema PostgreSQL](../rfc/RFC-0002-modelagem-de-dados-e-relacionamentos.md)
- Seção 6.1 de [docs/challenge/CHALLENGE.md](../challenge/CHALLENGE.md)

