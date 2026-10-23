# Diagrama Entidade-Relacionamento (ER) e Design Relacional

Referência visual do modelo de dados especificado no [RFC-0002](../rfc/RFC-0002-modelagem-de-dados-e-relacionamentos.md).

## 1. Diagrama ER Completo

```mermaid
erDiagram
    wallets ||--o{ wager_transactions : "1:N (wallet_id)"
    wallets ||--o{ wallet_ledger_entries : "1:N (wallet_id, currency)"
    wager_transactions ||--o| wallet_ledger_entries : "1:0..1 (transaction_id, wallet_id, currency)"
    wager_transactions |o--o{ wager_transactions : "auto-referência (reference_transaction_id)"
    wager_transactions ||--o{ outbox_messages : "1:N lógico (aggregate_id)"
    inbox_messages }o--o| wager_transactions : "dedup por (consumer_name, message_id)"

    wallets {
        uuid id PK "pk_wallets"
        uuid player_id "NOT NULL, uq_wallets__player_currency"
        char_3 currency "NOT NULL, ck_wallets__currency_iso"
        numeric_19_2 balance "NOT NULL, ck_wallets__balance_non_negative (>= 0)"
        integer version "NOT NULL, ck_wallets__version_positive (>= 1)"
        timestamptz created_at "NOT NULL"
        timestamptz updated_at "NOT NULL"
    }

    wager_transactions {
        uuid id PK "pk_wager_transactions"
        text provider_id "NOT NULL, uq (provider_id, external_transaction_id)"
        text external_transaction_id "NOT NULL"
        text idempotency_key "NOT NULL, uq (provider_id, idempotency_key)"
        char_64 payload_hash "NOT NULL, ck sha256 hex"
        uuid wallet_id FK "NOT NULL, fk_wager_transactions__wallet"
        uuid player_id "NOT NULL"
        text round_id "NOT NULL"
        text game_id "NOT NULL"
        text kind "NOT NULL, ck OPENING|BET|WIN|LOSS|REFUND|ROLLBACK"
        numeric_19_2 amount "NOT NULL, ck (> 0)"
        char_3 currency "NOT NULL, ck ISO-4217"
        text reference_external_transaction_id "NULLABLE, ck obrigatório p/ REFUND/ROLLBACK"
        uuid reference_transaction_id FK "NULLABLE, fk_wager_transactions__reference"
        text status "NOT NULL, ck PENDING|PENDING_REFERENCE|PROCESSED|REJECTED|FAILED"
        text failure_code "NULLABLE, ck NOT NULL sse REJECTED/FAILED"
        numeric_19_2 recorded_balance "NULLABLE, saldo observado no desfecho p/ replay"
        integer reference_attempts "NOT NULL DEFAULT 0, ck (>= 0)"
        timestamptz next_reference_attempt_at "NULLABLE"
        timestamptz created_at "NOT NULL"
        timestamptz processed_at "NULLABLE, ck NOT NULL sse terminal"
        timestamptz updated_at "NOT NULL"
    }

    wallet_ledger_entries {
        uuid id PK "pk_wallet_ledger_entries"
        uuid wallet_id FK "NOT NULL, fk (wallet_id, currency)"
        uuid transaction_id FK "NOT NULL, uq_wallet_ledger_entries__transaction"
        integer wallet_version "NOT NULL, uq (wallet_id, wallet_version)"
        text direction "NOT NULL, ck DEBIT|CREDIT"
        numeric_19_2 amount "NOT NULL, ck (> 0)"
        char_3 currency "NOT NULL, ck ISO-4217"
        numeric_19_2 balance_before "NOT NULL, ck (>= 0)"
        numeric_19_2 balance_after "NOT NULL, ck (>= 0) e ck aritmética exata"
        timestamptz created_at "NOT NULL"
    }

    inbox_messages {
        text consumer_name PK "pk_inbox_messages (composta)"
        text message_id PK "pk_inbox_messages (composta)"
        char_64 payload_hash "NOT NULL, ck sha256 hex"
        timestamptz received_at "NOT NULL"
        timestamptz processed_at "NULLABLE"
    }

    outbox_messages {
        uuid id PK "pk_outbox_messages (= eventId)"
        text aggregate_type "NOT NULL"
        uuid aggregate_id "NOT NULL"
        text event_type "NOT NULL"
        integer event_version "NOT NULL, ck (>= 1)"
        uuid correlation_id "NOT NULL"
        uuid causation_id "NULLABLE"
        jsonb payload "NOT NULL"
        timestamptz occurred_at "NOT NULL"
        integer attempts "NOT NULL DEFAULT 0, ck (>= 0)"
        timestamptz next_attempt_at "NOT NULL"
        timestamptz locked_until "NULLABLE"
        text locked_by "NULLABLE"
        timestamptz published_at "NULLABLE"
        text last_error "NULLABLE"
    }
```

## 2. Fluxo Transacional Atômico no Banco

Todas as escritas abaixo ocorrem dentro de uma única transação SQL (`READ COMMITTED`) coordenada pelo
`UnitOfWork` com lock pessimista na linha da `wallet`:

```mermaid
sequenceDiagram
    autonumber
    participant UC as ProcessWagerTransactionUseCase
    participant PG as PostgreSQL (Single SQL Transaction)

    UC->>PG: BEGIN
    opt Entrada via SQS Consumer
        UC->>PG: INSERT INTO inbox_messages (...) ON CONFLICT DO NOTHING
    end
    UC->>PG: SELECT * FROM wallets WHERE id = $walletId FOR UPDATE
    UC->>PG: SELECT * FROM wager_transactions WHERE provider_id = $p AND idempotency_key = $k
    alt Idempotency replay (mesmo payload_hash)
        PG-->>UC: Transação existente + recorded_balance
        UC->>PG: COMMIT
    else Nova transação
        UC->>PG: INSERT INTO wager_transactions (...)
        opt Operação afeta saldo e é PROCESSED
            UC->>PG: UPDATE wallets SET balance = $after, version = version + 1 WHERE id = $walletId AND version = $v
            UC->>PG: INSERT INTO wallet_ledger_entries (..., wallet_version = $v + 1)
        end
        UC->>PG: INSERT INTO outbox_messages (WagerTransaction* + WalletBalanceChanged)
        opt Entrada via SQS Consumer
            UC->>PG: UPDATE inbox_messages SET processed_at = now()
        end
        UC->>PG: COMMIT
    end
```

