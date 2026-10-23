# ADR-0015: Paginação do ledger por cursor opaco keyset (`created_at, id`)

- **Status**: Accepted
- **Data**: 2026-10-22
- **Fase do roadmap**: 5 — API HTTP
- **RFC relacionada**: [RFC-0005](../rfc/RFC-0005-api-http-validacao-e-tratamento-de-erros.md)

## Contexto e problema

O endpoint `GET /wallets/:walletId/ledger?cursor=...&limit=50` deve listar o histórico de lançamentos de uma carteira de forma estável sob inserções concorrentes. Paginação baseada em `OFFSET / LIMIT` degrada linearmente (`O(offset)`) em carteiras com milhares de apostas e sofre de *page drift* quando novos lançamentos são inseridos durante a navegação.

## Opções consideradas

1. **Keyset pagination por cursor opaco `base64url` contendo `{ createdAt, id }` apoiado pelo índice composto `(wallet_id, created_at ASC, id ASC)`**
2. **`OFFSET / LIMIT` numérico tradicional**
3. **Cursor apenas por `wallet_version`**

## Decisão

Adotar a **Opção 1**: cursor opaco codificado em `base64url(JSON.stringify({ createdAt, id }))` com predicado SQL tupla `(created_at, id) > ($2::timestamptz, $3::uuid)` ordenado por `created_at ASC, id ASC` e suportado pelo índice `ix_wallet_ledger_entries__wallet_cursor (wallet_id, created_at ASC, id ASC)`.

Para detectar a existência de próxima página sem `COUNT(*)`, a consulta busca `limit + 1` registros: se retornar `limit + 1`, os primeiros `limit` itens são devolvidos e `nextCursor` é gerado a partir do último item da página; caso contrário, `nextCursor = null`.

## Consequências

### Positivas

- Complexidade constante `O(log N)` por página via *index scan* em `ix_wallet_ledger_entries__wallet_cursor`, independentemente da profundidade da página.
- Ausência total de *page drift* (lançamentos são append-only e ordenados por `(created_at, id)`).
- Cursores malformados são rejeitados imediatamente com `FailureCode.InvalidPaginationCursor` (`HTTP 400`).

### Negativas / trade-offs

- Não permite saltar diretamente para uma página arbitrária "página 42" (comportamento padrão e esperado de APIs financeiras baseadas em cursor).

