---
name: document-api
description: >-
  Use this skill when creating, modifying, or documenting HTTP endpoints and OpenAPI specifications.
  Enforces professional documentation standards, sequence flow diagrams, exhaustive response scenarios
  (200, 201, 202, 400, 404, 409, 422, 429, 503), schema modeling, and strict information hiding
  between public partner documentation (black-box) and internal/ops documentation (white-box).
---

# Padronização de Documentação de API (OpenAPI, ReDoc & Swagger)

Esta skill define as regras obrigatórias para documentar qualquer novo endpoint, rota ou funcionalidade HTTP neste repositório.

## 1. Princípio de Separação e Ocultação de Informação (Information Hiding)

A regra de ocultação de fluxo interno aplica-se **exclusivamente às rotas públicas**. A documentação é dividida em dois níveis de visibilidade com propósitos distintos:

### 1.1 Documentação Pública para Parceiros (`/v1/api/docs` — ReDoc)
Voltada para Provedores de Jogos, Desenvolvedores Frontend e Integradores Externos.
- **Visão Estritamente Black-Box (Ocultação Obrigatória):** Descreve **o que** o sistema faz, quais contratos aceita, quais garantias oferece e como responde.
- **PROIBIDO vazar detalhes internos que só o backend deve saber:**
  - NUNCA incluir queries SQL (ex.: `SELECT ... FOR UPDATE`, `INSERT INTO wallets`, `LIMIT 21`).
  - NUNCA citar nomes de tabelas ou colunas internas do banco (ex.: `wager_tx`, `wallet_ledger_entries`, `outbox_messages`).
  - NUNCA expor workers e mecanismos internos assíncronos (ex.: `SKIP LOCKED`, leases de outbox, workers de backoff, tópicos de filas internas).
  - NUNCA expor stack traces, detalhes de driver PostgreSQL ou erros internos.
- **O que DEVE conter:**
  - Fluxos de negócio entre `[Game Provider / Partner]`, `[Wagering API Gateway]` e `[Core Financial Engine]`.
  - Protocolo de idempotência, validação de saldos, regras de reversão e estados de transação (`PROCESSED`, `PENDING_REFERENCE`).
  - Exemplos realistas e exaustivos de requisição e de resposta para **todos** os códigos HTTP possíveis (`200`, `201`, `202`, `400`, `404`, `409`, `422`, `429`, `503`).

### 1.2 Documentação Privada, Operacional & Interna (`/v1/api/docs/swagger` — Swagger UI)
Voltada para Engenheiros SRE, Auditores Internos, Desenvolvedores Backend e Avaliadores Técnicos.
- **Visão White-Box (NÃO OCULTAR):** Aqui NÃO se oculta a mecânica interna do backend! Pelo contrário: o backend DEVE detalhar exatamente como a mágica acontece por baixo do capô:
  - Rotas administrativas e de governança (`/wallets/:id/reconcile`, `/health/live`, `/health/ready`, `/metrics`).
  - Detalhamento de concorrência e banco: locks pessimistas (`SELECT wallet FOR UPDATE`), SQLs de verificação de invariantes (`SELECT SUM(direction * amount) FROM wallet_ledger_entries`), triggers e conciliação atômica.
  - Mecanismos de mensageria: Transactional Outbox com polling `FOR UPDATE SKIP LOCKED`, leases de workers, DLQ do SQS FIFO e estratégias de failover e retry exponencial.
  - Console interativo "Try It Out" para depuração e testes manuais de integração.

---

## 2. Diagramas de Sequência e Fluxo de Execução

Cada endpoint de negócio significativo deve conter um diagrama de sequência em bloco de código Markdown monospaçado dentro do campo `description`.

### Diretrizes de Formato:
1. **Caracteres Unicode/ASCII universais:** Use `│`, `─`, `┌`, `└`, `▼`, `▲` e setas `──>`, `<──`.
2. **Zero dependência externa:** Não use CDNs de renderização dinâmica no browser nem scripts que violem CSP. O texto monospaçado funciona instantaneamente em ReDoc, Swagger UI, Postman, IDEs e cURL.
3. **Participantes Padronizados no Público:**
   - `[Game Provider / Partner]`
   - `[Wagering API Gateway]`
   - `[Core Financial Engine]` (ou `[Core Financial Ledger]`)

### Exemplo de Diagrama Público Recomendado (Black-Box — Ocultação Ativa):
```text
[Game Provider / Partner]         [Wagering API Gateway]          [Core Financial Engine]
         │                                │                                │
         │─── POST /transactions ────────>│                                │
         │    (Idempotency-Key, BET)      │─── Rate Limit & Auth Check ────│
         │                                │─── Idempotency Hash Check ─────│
         │                                │                                │
         │                                │─── Authorize & Settle Bet ────>│
         │                                │    • Verify Active Wallet      │
         │                                │    • Assert Available Funds    │
         │                                │    • Mutate Balance Atomically │
         │                                │    • Record Immutable Ledger   │
         │                                │<── Bet Settled (v2) ───────────│
         │<── 201 Created (PROCESSED) ────│                                │
         │    {id, balance: "450.00"}     │                                │
```

### Exemplo de Diagrama Privado/Interno Recomendado (White-Box — Sem Ocultação, Detalhamento Total):
```text
[Auditor / SRE Operator]         [API Gateway]                 [PostgreSQL Engine]              [Transactional Outbox]
         │                             │                                │                                  │
         │─── POST /wallets/:id/reconcile>                              │                                  │
         │                             │─── BEGIN TRANSACTION ─────────>│                                  │
         │                             │    SELECT wallet FOR UPDATE ───│ (Pessimistic Row Lock)           │
         │                             │    SELECT SUM(direction*amount)│                                  │
         │                             │      FROM ledger entries ─────>│ (Reconstruct From History)       │
         │                             │<── ledgerSum, walletBalance ───│                                  │
         │                             │                                │                                  │
         │                             │─── Divergence Detected? ───────│                                  │
         │                             │    [Yes]: UPDATE wallet balance│                                  │
         │                             │           INSERT audit ledger  │                                  │
         │                             │           INSERT outbox_events>│─── Event: wallet.reconciled ─────│
         │                             │    [No]:  Clean Verification   │                                  │
         │                             │─── COMMIT TRANSACTION ────────>│                                  │
         │<── 200 OK ──────────────────│                                │                                  │
         │    {reconciledBalance,      │                                │                                  │
         │     hasDivergence: false}   │                                │                                  │
```

---

## 3. Cobertura Exaustiva de Exemplos de Resposta

Todo endpoint deve documentar o sucesso e **todos os cenários de erro possíveis**:

| Status HTTP | Cenário | Obrigatório |
|---|---|---|
| **200 OK / 201 Created / 202 Accepted** | Sucesso (com exemplos para cada subtipo de operação se houver, ex.: BET, WIN, LOSS, REFUND, ROLLBACK) | Sim |
| **400 Bad Request** | Erro de validação de schema Zod, campos faltantes ou tipos/formatos inválidos | Sim |
| **404 Not Found** | Recurso não encontrado (ex.: carteira ou transação inexistente) | Sim (quando houver IDs) |
| **409 Conflict** | Conflito de recurso ou idempotência (ex.: mesma chave com payload diferente) | Sim (se usar idempotência) |
| **422 Unprocessable Entity** | Violação de regra de negócio (`INSUFFICIENT_FUNDS`, `REFERENCE_ALREADY_REVERSED`, etc.) | Sim (em mutações financeiras) |
| **429 Too Many Requests** | Excesso de requisições por IP/token (Rate Limiting) | Sim |
| **503 Service Unavailable** | Dependência indisponível ou manutenção do processador | Sim |

Cada exemplo deve utilizar a estrutura de múltiplos exemplos nomeados (`examples: { exampleKey: { summary, value } }`) no OpenAPI.

---

## 4. Padronização de Schemas em `components.schemas`

1. **Reutilização e Tipagem Forte:** Nenhum endpoint deve declarar objetos inline anônimos para DTOs principais; use `$ref: "#/components/schemas/<SchemaName>"`.
2. **Propriedades Completas:** Todo campo dentro de `properties` deve conter:
   - `type` (e `enum` quando aplicável).
   - `description` explicando a semântica de negócio.
   - `example` com valor representativo e realista.
3. **Lista de `required`:** Declare explicitamente os campos obrigatórios.

---

## 5. Profissionalismo Visual e Apresentação

- **Proibido o uso de emojis informais** (como 🎰, 🎲, 🔒, 🚀) em títulos de documentação, descrições de API ou favicons.
- Favicons devem usar SVGs minimalistas profissionais.
- A paleta de cores no ReDoc e Swagger UI deve manter contraste corporativo limpo (azul profissional `#2563eb`, fundo neutro `#ffffff`).

---

## 6. Regras de Código TypeScript

- **Zero Comentários em `.ts`:** Conforme regra global do projeto, é proibido adicionar comentários de código (`//` ou `/* */`). As explicações e fluxos residem nas strings declarativas do OpenAPI e nos arquivos Markdown (`docs/`).
- **Path Aliases Estritos:** Qualquer import em controllers ou specs de documentação deve usar `@domain/*`, `@application/*`, `@interfaces/*`, etc.

---

## 7. Checklist para Novos Endpoints / Alterações

Ao implementar ou alterar uma rota:
- [ ] O endpoint está registrado na especificação correta (`PUBLIC_OPENAPI_SPECIFICATION` ou `PRIVATE_OPENAPI_SPECIFICATION`)?
- [ ] Se público: o diagrama de sequência é **estritamente black-box** e não vaza queries SQL, nomes de tabelas ou workers internos?
- [ ] Os schemas de request e response estão modelados em `components.schemas` com tipos, exemplos e descrições?
- [ ] Foram incluídos múltiplos exemplos cobrindo sucesso e **todos** os erros possíveis (`400`, `404`, `409`, `422`, `429`, `503`)?
- [ ] Testes de unidade em `test/unit/interfaces/docs-controller.spec.ts` validam os contratos e a presença dos fluxos?
- [ ] Biome check (`bun biome check`) e TypeScript typecheck (`bun typecheck`) passam sem erros?
