export interface PostgresErrorMetadata {
  readonly code?: string | undefined;
  readonly constraint?: string | undefined;
  readonly detail?: string | undefined;
  readonly message: string;
}

export interface RawPgError {
  readonly code?: unknown;
  readonly constraint?: unknown;
  readonly detail?: unknown;
  readonly message?: unknown;
  readonly cause?: unknown;
}

export interface WalletSqlRow {
  readonly id: string;
  readonly player_id: string;
  readonly currency: string;
  readonly balance: string;
  readonly version: number;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

export interface WagerTransactionSqlRow {
  readonly id: string;
  readonly provider_id: string;
  readonly external_transaction_id: string;
  readonly idempotency_key: string;
  readonly payload_hash: string;
  readonly wallet_id: string;
  readonly player_id: string;
  readonly round_id: string;
  readonly game_id: string;
  readonly kind: string;
  readonly amount: string;
  readonly currency: string;
  readonly reference_external_transaction_id: string | null;
  readonly reference_transaction_id: string | null;
  readonly status: string;
  readonly failure_code: string | null;
  readonly recorded_balance: string | null;
  readonly reference_attempts: number;
  readonly next_reference_attempt_at: Date | string | null;
  readonly created_at: Date | string;
  readonly processed_at: Date | string | null;
  readonly updated_at: Date | string;
}

export interface WalletLedgerEntrySqlRow {
  readonly id: string;
  readonly wallet_id: string;
  readonly transaction_id: string;
  readonly wallet_version: number;
  readonly direction: string;
  readonly amount: string;
  readonly currency: string;
  readonly balance_before: string;
  readonly balance_after: string;
  readonly created_at: Date | string;
}

export interface OutboxMessageSqlRow {
  readonly id: string;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly event_type: string;
  readonly event_version: number;
  readonly correlation_id: string;
  readonly causation_id: string | null;
  readonly payload: Record<string, unknown> | string;
  readonly occurred_at: Date | string;
  readonly attempts: number;
  readonly next_attempt_at: Date | string;
  readonly locked_until: Date | string | null;
  readonly locked_by: string | null;
  readonly published_at: Date | string | null;
  readonly last_error: string | null;
}

export interface InboxMessageSqlRow {
  readonly consumer_name: string;
  readonly message_id: string;
  readonly payload_hash: string;
  readonly received_at: Date | string;
  readonly processed_at: Date | string | null;
}
