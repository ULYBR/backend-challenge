import { join } from "node:path";
import { Controller, Get, Res } from "@nestjs/common";
import type { Response } from "express";

const SCHEMAS = {
  OpenWalletRequest: {
    type: "object",
    required: ["playerId", "currency", "initialBalance"],
    properties: {
      playerId: {
        type: "string",
        example: "player-100",
        description: "Unique external identifier of the player",
      },
      currency: {
        type: "string",
        example: "BRL",
        description: "ISO 4217 standard 3-letter currency code",
      },
      initialBalance: {
        type: "string",
        example: "500.00",
        description: "Initial opening balance as a non-negative 2-decimal string",
      },
    },
  },
  WalletResponse: {
    type: "object",
    required: ["id", "playerId", "currency", "balance", "version"],
    properties: {
      id: {
        type: "string",
        example: "019488a0-1111-7000-8000-000000000001",
        description: "Deterministic internal UUIDv7 identifier of the wallet",
      },
      playerId: {
        type: "string",
        example: "player-100",
        description: "Owner player identifier",
      },
      currency: {
        type: "string",
        example: "BRL",
        description: "Wallet currency",
      },
      balance: {
        type: "string",
        example: "500.00",
        description: "Current wallet balance matching exact sum of ledger entries",
      },
      version: {
        type: "integer",
        example: 1,
        description: "Monotonically increasing version counter incremented on each mutation",
      },
    },
  },
  ProcessTransactionRequest: {
    type: "object",
    required: [
      "walletId",
      "providerId",
      "externalTransactionId",
      "idempotencyKey",
      "kind",
      "amount",
      "currency",
    ],
    properties: {
      walletId: {
        type: "string",
        example: "019488a0-1111-7000-8000-000000000001",
        description: "Target wallet UUIDv7 identifier",
      },
      providerId: {
        type: "string",
        example: "provider-evolution",
        description: "External game provider identifier",
      },
      externalTransactionId: {
        type: "string",
        example: "tx-bet-001",
        description: "Provider's external transaction reference",
      },
      idempotencyKey: {
        type: "string",
        example: "idem-bet-001",
        description: "Unique idempotency key used with canonical SHA-256 hash deduplication",
      },
      kind: {
        type: "string",
        enum: ["BET", "WIN", "LOSS", "REFUND", "ROLLBACK"],
        description: "Financial transaction operation type",
      },
      amount: {
        type: "string",
        example: "50.00",
        description: "Transaction monetary amount with at most 2 decimal places",
      },
      currency: {
        type: "string",
        example: "BRL",
        description: "ISO 4217 currency code. Must match wallet currency",
      },
      referenceTransactionId: {
        type: "string",
        example: "tx-bet-001",
        description:
          "Mandatory for REFUND and ROLLBACK. External transaction ID of the referenced BET",
      },
    },
  },
  TransactionResponse: {
    type: "object",
    required: [
      "id",
      "walletId",
      "providerId",
      "externalTransactionId",
      "kind",
      "amount",
      "currency",
      "status",
      "balance",
      "walletVersion",
      "idempotentReplay",
      "createdAt",
    ],
    properties: {
      id: {
        type: "string",
        example: "019488a0-2222-7000-8000-000000000002",
        description: "Internal UUIDv7 transaction identifier",
      },
      walletId: { type: "string", example: "019488a0-1111-7000-8000-000000000001" },
      providerId: { type: "string", example: "provider-evolution" },
      externalTransactionId: { type: "string", example: "tx-bet-001" },
      referenceTransactionId: { type: "string", nullable: true, example: null },
      kind: {
        type: "string",
        enum: ["BET", "WIN", "LOSS", "REFUND", "ROLLBACK", "OPENING"],
      },
      amount: { type: "string", example: "50.00" },
      currency: { type: "string", example: "BRL" },
      status: {
        type: "string",
        enum: ["PROCESSED", "PENDING_REFERENCE", "REJECTED", "FAILED"],
        example: "PROCESSED",
      },
      balance: {
        type: "string",
        example: "450.00",
        description: "Wallet balance immediately after this transaction",
      },
      walletVersion: {
        type: "integer",
        example: 2,
        description: "Wallet version produced by this transaction",
      },
      idempotentReplay: {
        type: "boolean",
        example: false,
        description: "True if this response is a replay of an existing identical request",
      },
      message: { type: "string", nullable: true, example: null },
      createdAt: { type: "string", example: "2026-10-23T18:00:00.000Z" },
    },
  },
  RejectedTransactionResponse: {
    type: "object",
    required: ["id", "walletId", "status", "failureCode", "message", "balance", "idempotentReplay"],
    properties: {
      id: { type: "string", example: "019488a0-5555-7000-8000-000000000005" },
      walletId: { type: "string", example: "019488a0-1111-7000-8000-000000000001" },
      status: { type: "string", enum: ["REJECTED"], example: "REJECTED" },
      failureCode: {
        type: "string",
        enum: [
          "INSUFFICIENT_FUNDS",
          "REVERSAL_WOULD_CAUSE_NEGATIVE_BALANCE",
          "CURRENCY_MISMATCH",
          "WALLET_OWNERSHIP_MISMATCH",
          "INVALID_REFERENCE_KIND",
          "REFERENCE_CONTEXT_MISMATCH",
          "REFERENCE_AMOUNT_MISMATCH",
          "REFERENCE_NOT_PROCESSED",
          "REFERENCE_ALREADY_REVERSED",
          "REFERENCE_NOT_FOUND_TIMEOUT",
        ],
        example: "INSUFFICIENT_FUNDS",
      },
      message: {
        type: "string",
        example:
          "Wallet w-100 has insufficient funds for debit of 1000.00 BRL (current balance: 500.00 BRL)",
      },
      balance: { type: "string", example: "500.00" },
      idempotentReplay: { type: "boolean", example: false },
    },
  },
  ErrorResponse: {
    type: "object",
    required: ["error"],
    properties: {
      error: {
        type: "object",
        required: ["code", "failureCode", "message"],
        properties: {
          code: { type: "string", example: "VALIDATION_ERROR" },
          failureCode: { type: "string", example: "INVALID_MONEY_AMOUNT" },
          message: { type: "string", example: "Validation failed" },
          details: {
            type: "array",
            items: {
              type: "object",
              properties: {
                field: { type: "string" },
                issue: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
  LedgerEntryResponse: {
    type: "object",
    required: [
      "id",
      "walletId",
      "walletVersion",
      "transactionId",
      "direction",
      "amount",
      "balanceBefore",
      "balanceAfter",
      "createdAt",
    ],
    properties: {
      id: { type: "string", example: "019488a0-3333-7000-8000-000000000003" },
      walletId: { type: "string", example: "019488a0-1111-7000-8000-000000000001" },
      walletVersion: { type: "integer", example: 2 },
      transactionId: { type: "string", example: "019488a0-2222-7000-8000-000000000002" },
      direction: { type: "string", enum: ["CREDIT", "DEBIT"], example: "DEBIT" },
      amount: { type: "string", example: "50.00" },
      balanceBefore: { type: "string", example: "500.00" },
      balanceAfter: { type: "string", example: "450.00" },
      createdAt: { type: "string", example: "2026-10-23T18:00:00.000Z" },
    },
  },
  LedgerPageResponse: {
    type: "object",
    required: ["entries", "nextCursor", "hasMore"],
    properties: {
      entries: {
        type: "array",
        items: { $ref: "#/components/schemas/LedgerEntryResponse" },
      },
      nextCursor: {
        type: "string",
        nullable: true,
        example: "ZXlKMWMyVnlZWFJmWkdGMFpTSTZJakkw...",
      },
      hasMore: { type: "boolean", example: true },
    },
  },
  ReconcileResponse: {
    type: "object",
    required: [
      "walletId",
      "currency",
      "previousBalance",
      "calculatedLedgerBalance",
      "reconciledBalance",
      "hasDivergence",
      "totalLedgerEntries",
    ],
    properties: {
      walletId: { type: "string", example: "019488a0-1111-7000-8000-000000000001" },
      currency: { type: "string", example: "BRL" },
      previousBalance: { type: "string", example: "450.00" },
      calculatedLedgerBalance: { type: "string", example: "450.00" },
      reconciledBalance: { type: "string", example: "450.00" },
      hasDivergence: { type: "boolean", example: false },
      totalLedgerEntries: { type: "integer", example: 42 },
    },
  },
};

const COMMON_SERVERS = [
  {
    url: "http://localhost:3000",
    description: "Local Development Server",
  },
];

const PUBLIC_PATHS = {
  "/v1/api/wallets": {
    post: {
      tags: ["Wallets"],
      summary: "Open a new player wallet",
      description: `Creates a new player wallet with positive initialBalance, initializing an OPENING transaction and genesis ledger entry at version 1.

\`\`\`
[Game Provider / Partner]         [Wagering API Gateway]          [Core Financial Ledger]
         │                                │                                │
         │─── POST /v1/api/wallets ──────>│                                │
         │    (playerId, currency,        │─── Validate Schema & Currency ─│
         │     initialBalance)            │                                │
         │                                │─── Genesis Opening Request ───>│
         │                                │    • Assert Player Uniqueness  │
         │                                │    • Initialize Zero-Balance   │
         │                                │    • Credit Opening Balance    │
         │                                │<── Wallet Opened (v1) ─────────│
         │<── 201 Created ────────────────│                                │
         │    {id, balance: "500.00"}     │                                │
\`\`\``,
      operationId: "openWallet",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/OpenWalletRequest" },
            examples: {
              standardOpeningBrl: {
                summary: "Standard BRL Opening",
                value: {
                  playerId: "player-100",
                  currency: "BRL",
                  initialBalance: "500.00",
                },
              },
              openingUsd: {
                summary: "USD Wallet Opening",
                value: {
                  playerId: "player-200",
                  currency: "USD",
                  initialBalance: "1000.00",
                },
              },
            },
          },
        },
      },
      responses: {
        "201": {
          description: "Wallet opened successfully with genesis ledger entry",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/WalletResponse" },
              example: {
                id: "019488a0-1111-7000-8000-000000000001",
                playerId: "player-100",
                currency: "BRL",
                balance: "500.00",
                version: 1,
              },
            },
          },
        },
        "400": {
          description: "Bad request — malformed payload, invalid currency or monetary format",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
              examples: {
                invalidAmount: {
                  summary: "Invalid Monetary Format",
                  value: {
                    error: {
                      code: "VALIDATION_ERROR",
                      failureCode: "INVALID_MONEY_AMOUNT",
                      message:
                        "initialBalance must be a non-negative decimal string with at most 2 decimal places",
                    },
                  },
                },
                invalidCurrency: {
                  summary: "Invalid Currency Code",
                  value: {
                    error: {
                      code: "VALIDATION_ERROR",
                      failureCode: "INVALID_CURRENCY_CODE",
                      message: "Currency 'XYZ' is not a recognized ISO 4217 code",
                    },
                  },
                },
                missingPlayerId: {
                  summary: "Missing Required Field",
                  value: {
                    error: {
                      code: "VALIDATION_ERROR",
                      failureCode: "VALIDATION_ERROR",
                      message: "Required field 'playerId' is missing",
                    },
                  },
                },
              },
            },
          },
        },
        "409": {
          description: "Conflict — wallet already exists for this playerId and currency",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
              example: {
                error: {
                  code: "WALLET_ALREADY_EXISTS",
                  failureCode: "WALLET_ALREADY_EXISTS",
                  message: "A wallet for playerId 'player-100' and currency 'BRL' already exists",
                },
              },
            },
          },
        },
        "429": {
          description: "Rate limit exceeded (Too Many Requests)",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
              example: {
                error: {
                  code: "RATE_LIMIT_EXCEEDED",
                  failureCode: "RATE_LIMIT_EXCEEDED",
                  message: "Rate limit quota exceeded. Retry after 60 seconds.",
                },
              },
            },
          },
        },
      },
    },
  },
  "/v1/api/wallets/{id}": {
    get: {
      tags: ["Wallets"],
      summary: "Get wallet details by ID",
      operationId: "getWalletById",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string" },
          description: "Wallet identifier (e.g., 019488a0-1111-7000-8000-000000000001)",
        },
      ],
      responses: {
        "200": {
          description: "Wallet retrieved successfully",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/WalletResponse" },
              example: {
                id: "019488a0-1111-7000-8000-000000000001",
                playerId: "player-100",
                currency: "BRL",
                balance: "500.00",
                version: 1,
              },
            },
          },
        },
        "404": {
          description: "Wallet not found",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
              example: {
                error: {
                  code: "WALLET_NOT_FOUND",
                  failureCode: "WALLET_NOT_FOUND",
                  message: "Wallet '019488a0-0000-0000-0000-000000000000' not found",
                },
              },
            },
          },
        },
      },
    },
  },
  "/v1/api/wallets/{id}/ledger": {
    get: {
      tags: ["Wallets"],
      summary: "List immutable wallet ledger entries",
      description: `Extracts immutable append-only ledger entries using deterministic base64 keyset cursor pagination over (createdAt, id).

\`\`\`
[Auditor / Partner]               [Wagering API Gateway]          [Core Financial Ledger]
         │                                │                                │
         │─── GET /wallets/:id/ledger ───>│                                │
         │    ?cursor=eyJ...&limit=20     │─── Decode Keyset Cursor ───────│
         │                                │    (timestamp, entryId)        │
         │                                │                                │
         │                                │─── Fetch Ledger Page ─────────>│
         │                                │    • Filter by Target Wallet   │
         │                                │    • Keyset Window (limit + 1) │
         │                                │<── Ledger Entries Record Set ──│
         │                                │                                │
         │                                │─── Compute Opaque Next Cursor ─│
         │<── 200 OK ─────────────────────│                                │
         │    {entries, nextCursor}       │                                │
\`\`\``,
      operationId: "listWalletLedger",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "cursor",
          in: "query",
          required: false,
          schema: { type: "string" },
          description: "Opaque base64 cursor for keyset pagination",
        },
        {
          name: "limit",
          in: "query",
          required: false,
          schema: { type: "integer", default: 20, maximum: 100 },
        },
      ],
      responses: {
        "200": {
          description: "Ledger entries page retrieved",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/LedgerPageResponse" },
              example: {
                entries: [
                  {
                    id: "019488a0-3333-7000-8000-000000000003",
                    walletId: "019488a0-1111-7000-8000-000000000001",
                    walletVersion: 2,
                    transactionId: "019488a0-2222-7000-8000-000000000002",
                    direction: "DEBIT",
                    amount: "50.00",
                    balanceBefore: "500.00",
                    balanceAfter: "450.00",
                    createdAt: "2026-10-23T18:00:00.000Z",
                  },
                  {
                    id: "019488a0-1111-7000-8000-000000000002",
                    walletId: "019488a0-1111-7000-8000-000000000001",
                    walletVersion: 1,
                    transactionId: "019488a0-1111-7000-8000-000000000001",
                    direction: "CREDIT",
                    amount: "500.00",
                    balanceBefore: "0.00",
                    balanceAfter: "500.00",
                    createdAt: "2026-10-23T17:50:00.000Z",
                  },
                ],
                nextCursor: "ZXlKMWMyVnlZWFJmWkdGMFpTSTZJakkw...==",
                hasMore: false,
              },
            },
          },
        },
        "400": {
          description: "Malformed pagination cursor",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
              example: {
                error: {
                  code: "INVALID_PAGINATION_CURSOR",
                  failureCode: "INVALID_PAGINATION_CURSOR",
                  message: "Cursor must be a valid base64-encoded JSON payload",
                },
              },
            },
          },
        },
        "404": {
          description: "Wallet not found",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
              example: {
                error: {
                  code: "WALLET_NOT_FOUND",
                  failureCode: "WALLET_NOT_FOUND",
                  message: "Wallet not found",
                },
              },
            },
          },
        },
      },
    },
  },
  "/v1/api/wagering/transactions": {
    post: {
      tags: ["Wagering"],
      summary: "Process a wagering transaction (BET, WIN, LOSS, REFUND, ROLLBACK)",
      description: `Processes financial betting operations (BET, WIN, LOSS, REFUND, ROLLBACK) with persistent idempotency, pessimistic row-level locking, append-only ledger entries, transactional outbox events, and out-of-order pending reference resolution.

### Primary Financial Transaction Lifecycle
\`\`\`
[Game Provider / Partner]         [Wagering API Gateway]          [Core Financial Engine]
         │                                │                                │
         │─── POST /transactions ────────>│                                │
         │    (Idempotency-Key,           │─── Rate Limit & Auth Check ────│
         │     kind: BET, amount)         │─── Canonical Signature Hash ───│
         │                                │                                │
         │                                │─── Check Idempotency Record ──>│
         │                                │<── [Hit]: Replay Result ───────│
         │<── 200 OK (Idempotent Replay) ─│    (If payload differs: 409)   │
         │                                │                                │
         │                                │─── [Miss]: Authorize & Settle ─>│
         │                                │    • Lock Wallet Concurrently  │
         │                                │    • Validate Funds & Currency │
         │                                │    • Mutate Balance Atomically │
         │                                │    • Append Immutable Ledger   │
         │                                │<── Transaction Finalized ──────│
         │<── 201 Created (PROCESSED) ────│                                │
         │    {id, balance, version: 2}   │                                │
\`\`\`

### Out-of-Order Reversal Handling (REFUND / ROLLBACK before BET)
\`\`\`
[Game Provider / Partner]         [Wagering API Gateway]          [Core Financial Engine]
         │                                │                                │
         │─── POST tx (REFUND) ──────────>│                                │
         │    (ref: BET-EXT-99)           │─── Check Referenced Bet ──────>│
         │                                │<── Not Found (Arrived Early) ──│
         │                                │                                │
         │                                │─── Register Pending Reference ─>│
         │<── 202 Accepted ───────────────│                                │
         │    (status: PENDING_REFERENCE) │                                │
         │                                │    [Asynchronous Resolution]   │
         │                                │    When BET arrives, Engine    │
         │                                │    settles REFUND debit        │
         │                                │    automatically in background │
\`\`\``,
      operationId: "processWagerTransaction",
      headers: {
        "X-Provider-Id": {
          description: "Game provider identifier",
          schema: { type: "string" },
          required: true,
        },
      },
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ProcessTransactionRequest" },
            examples: {
              bet: {
                summary: "Place a Bet (DEBIT)",
                value: {
                  walletId: "019488a0-1111-7000-8000-000000000001",
                  providerId: "provider-evolution",
                  externalTransactionId: "tx-bet-001",
                  idempotencyKey: "idem-bet-001",
                  kind: "BET",
                  amount: "50.00",
                  currency: "BRL",
                },
              },
              win: {
                summary: "Settle a Win (CREDIT)",
                value: {
                  walletId: "019488a0-1111-7000-8000-000000000001",
                  providerId: "provider-evolution",
                  externalTransactionId: "tx-win-001",
                  idempotencyKey: "idem-win-001",
                  kind: "WIN",
                  amount: "150.00",
                  currency: "BRL",
                },
              },
              loss: {
                summary: "Settle a Loss (No Balance Effect)",
                value: {
                  walletId: "019488a0-1111-7000-8000-000000000001",
                  providerId: "provider-evolution",
                  externalTransactionId: "tx-loss-001",
                  idempotencyKey: "idem-loss-001",
                  kind: "LOSS",
                  amount: "50.00",
                  currency: "BRL",
                },
              },
              refund: {
                summary: "Refund a Bet (CREDIT with Reference)",
                value: {
                  walletId: "019488a0-1111-7000-8000-000000000001",
                  providerId: "provider-evolution",
                  externalTransactionId: "tx-ref-001",
                  idempotencyKey: "idem-ref-001",
                  kind: "REFUND",
                  amount: "50.00",
                  currency: "BRL",
                  referenceTransactionId: "tx-bet-001",
                },
              },
              rollback: {
                summary: "Rollback a Win (DEBIT with Reference)",
                value: {
                  walletId: "019488a0-1111-7000-8000-000000000001",
                  providerId: "provider-evolution",
                  externalTransactionId: "tx-rbk-001",
                  idempotencyKey: "idem-rbk-001",
                  kind: "ROLLBACK",
                  amount: "150.00",
                  currency: "BRL",
                  referenceTransactionId: "tx-win-001",
                },
              },
            },
          },
        },
      },
      responses: {
        "201": {
          description: "Transaction PROCESSED successfully (New financial execution)",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TransactionResponse" },
              examples: {
                betProcessed: {
                  summary: "Bet Processed (Balance Debited)",
                  value: {
                    id: "019488a0-2222-7000-8000-000000000002",
                    walletId: "019488a0-1111-7000-8000-000000000001",
                    providerId: "provider-evolution",
                    externalTransactionId: "tx-bet-001",
                    kind: "BET",
                    amount: "50.00",
                    currency: "BRL",
                    status: "PROCESSED",
                    balance: "450.00",
                    walletVersion: 2,
                    idempotentReplay: false,
                    createdAt: "2026-10-23T18:00:00.000Z",
                  },
                },
                winProcessed: {
                  summary: "Win Processed (Balance Credited)",
                  value: {
                    id: "019488a0-3333-7000-8000-000000000003",
                    walletId: "019488a0-1111-7000-8000-000000000001",
                    providerId: "provider-evolution",
                    externalTransactionId: "tx-win-001",
                    kind: "WIN",
                    amount: "150.00",
                    currency: "BRL",
                    status: "PROCESSED",
                    balance: "600.00",
                    walletVersion: 3,
                    idempotentReplay: false,
                    createdAt: "2026-10-23T18:01:00.000Z",
                  },
                },
                refundProcessed: {
                  summary: "Refund Processed (Bet Reversal Credited)",
                  value: {
                    id: "019488a0-4444-7000-8000-000000000004",
                    walletId: "019488a0-1111-7000-8000-000000000001",
                    providerId: "provider-evolution",
                    externalTransactionId: "tx-ref-001",
                    referenceTransactionId: "tx-bet-001",
                    kind: "REFUND",
                    amount: "50.00",
                    currency: "BRL",
                    status: "PROCESSED",
                    balance: "650.00",
                    walletVersion: 4,
                    idempotentReplay: false,
                    createdAt: "2026-10-23T18:02:00.000Z",
                  },
                },
              },
            },
          },
        },
        "200": {
          description:
            "Idempotent Replay (matching idempotencyKey and canonical SHA-256 payloadHash)",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TransactionResponse" },
              example: {
                id: "019488a0-2222-7000-8000-000000000002",
                walletId: "019488a0-1111-7000-8000-000000000001",
                providerId: "provider-evolution",
                externalTransactionId: "tx-bet-001",
                kind: "BET",
                amount: "50.00",
                currency: "BRL",
                status: "PROCESSED",
                balance: "450.00",
                walletVersion: 2,
                idempotentReplay: true,
                createdAt: "2026-10-23T18:00:00.000Z",
              },
            },
          },
        },
        "202": {
          description:
            "ACCEPTED with PENDING_REFERENCE (Out-of-Order: referenced BET has not yet arrived)",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TransactionResponse" },
              example: {
                id: "019488a0-5555-7000-8000-000000000005",
                walletId: "019488a0-1111-7000-8000-000000000001",
                providerId: "provider-evolution",
                externalTransactionId: "tx-ref-early",
                referenceTransactionId: "tx-bet-delayed",
                kind: "REFUND",
                amount: "50.00",
                currency: "BRL",
                status: "PENDING_REFERENCE",
                balance: "500.00",
                walletVersion: 1,
                idempotentReplay: false,
                message: "Transaction accepted and awaiting arrival of referenced transaction",
                createdAt: "2026-10-23T18:03:00.000Z",
              },
            },
          },
        },
        "400": {
          description: "Bad Request — Validation error, invalid currency or format",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
              examples: {
                invalidAmount: {
                  summary: "Invalid Monetary Amount",
                  value: {
                    error: {
                      code: "VALIDATION_ERROR",
                      failureCode: "INVALID_MONEY_AMOUNT",
                      message:
                        "Amount must be a non-negative decimal string with at most 2 decimal places (e.g. '50.00')",
                    },
                  },
                },
                invalidCurrency: {
                  summary: "Invalid Currency Code",
                  value: {
                    error: {
                      code: "VALIDATION_ERROR",
                      failureCode: "INVALID_CURRENCY_CODE",
                      message: "Currency 'XYZ' is not a supported ISO 4217 standard currency",
                    },
                  },
                },
                missingProviderHeader: {
                  summary: "Missing Provider Header",
                  value: {
                    error: {
                      code: "MISSING_HEADER",
                      failureCode: "MISSING_HEADER",
                      message: "Header 'X-Provider-Id' is required",
                    },
                  },
                },
                forbiddenOpening: {
                  summary: "Forbidden Opening Kind",
                  value: {
                    error: {
                      code: "FORBIDDEN_KIND",
                      failureCode: "FORBIDDEN_OPENING_TRANSACTION",
                      message: "External creation of OPENING transactions is forbidden",
                    },
                  },
                },
              },
            },
          },
        },
        "409": {
          description: "Conflict — Idempotency key reused with differing payload",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
              example: {
                error: {
                  code: "IDEMPOTENCY_PAYLOAD_CONFLICT",
                  failureCode: "IDEMPOTENCY_PAYLOAD_CONFLICT",
                  message:
                    "Idempotency key 'idem-bet-001' already used with differing transaction payload",
                },
              },
            },
          },
        },
        "422": {
          description: "Unprocessable Entity — Financial business domain rule rejection",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RejectedTransactionResponse" },
              examples: {
                insufficientFunds: {
                  summary: "Insufficient Balance for Debit",
                  value: {
                    id: "019488a0-6666-7000-8000-000000000006",
                    walletId: "019488a0-1111-7000-8000-000000000001",
                    status: "REJECTED",
                    failureCode: "INSUFFICIENT_FUNDS",
                    message:
                      "Wallet has insufficient funds for debit of 1000.00 BRL (current balance: 500.00 BRL)",
                    balance: "500.00",
                    idempotentReplay: false,
                  },
                },
                referenceAlreadyReversed: {
                  summary: "Referenced Transaction Already Reversed",
                  value: {
                    id: "019488a0-7777-7000-8000-000000000007",
                    walletId: "019488a0-1111-7000-8000-000000000001",
                    status: "REJECTED",
                    failureCode: "REFERENCE_ALREADY_REVERSED",
                    message:
                      "Referenced transaction tx-bet-001 has already been reversed by a previous REFUND or ROLLBACK",
                    balance: "500.00",
                    idempotentReplay: false,
                  },
                },
                currencyMismatch: {
                  summary: "Currency Mismatch with Wallet",
                  value: {
                    id: "019488a0-8888-7000-8000-000000000008",
                    walletId: "019488a0-1111-7000-8000-000000000001",
                    status: "REJECTED",
                    failureCode: "CURRENCY_MISMATCH",
                    message: "Transaction currency USD does not match wallet currency BRL",
                    balance: "500.00",
                    idempotentReplay: false,
                  },
                },
                referenceAmountMismatch: {
                  summary: "Reversal Amount Mismatch",
                  value: {
                    id: "019488a0-9999-7000-8000-000000000009",
                    walletId: "019488a0-1111-7000-8000-000000000001",
                    status: "REJECTED",
                    failureCode: "REFERENCE_AMOUNT_MISMATCH",
                    message: "Refund amount 60.00 does not match referenced BET amount 50.00",
                    balance: "500.00",
                    idempotentReplay: false,
                  },
                },
                reversalNegativeBalance: {
                  summary: "Reversal Would Cause Negative Balance",
                  value: {
                    id: "019488a0-aaaa-7000-8000-00000000000a",
                    walletId: "019488a0-1111-7000-8000-000000000001",
                    status: "REJECTED",
                    failureCode: "REVERSAL_WOULD_CAUSE_NEGATIVE_BALANCE",
                    message:
                      "Rollback of WIN rejected because player has already spent the balance",
                    balance: "10.00",
                    idempotentReplay: false,
                  },
                },
              },
            },
          },
        },
        "429": {
          description: "Rate limit exceeded (Too Many Requests)",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
              example: {
                error: {
                  code: "RATE_LIMIT_EXCEEDED",
                  failureCode: "RATE_LIMIT_EXCEEDED",
                  message:
                    "Too Many Requests. Quota exceeded for provider 'provider-evolution'. Retry after 60 seconds.",
                },
              },
            },
          },
        },
        "503": {
          description:
            "Service Unavailable — Transient infrastructure failure (Safe to retry with same idempotency key)",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
              example: {
                error: {
                  code: "TRANSIENT_INFRASTRUCTURE_ERROR",
                  failureCode: "TRANSIENT_INFRASTRUCTURE_ERROR",
                  message:
                    "Database lock timeout acquiring wallet row lock. Safe to retry with same idempotency key.",
                },
              },
            },
          },
        },
      },
    },
  },
  "/v1/api/wagering/transactions/{id}": {
    get: {
      tags: ["Wagering"],
      summary: "Get transaction by internal UUIDv7",
      operationId: "getTransactionById",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": {
          description: "Transaction found",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TransactionResponse" },
            },
          },
        },
        "404": {
          description: "Transaction not found",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
              example: {
                error: {
                  code: "TRANSACTION_NOT_FOUND",
                  failureCode: "TRANSACTION_NOT_FOUND",
                  message: "Transaction not found",
                },
              },
            },
          },
        },
      },
    },
  },
  "/v1/api/wagering/transactions/external/{providerId}/{externalTransactionId}": {
    get: {
      tags: ["Wagering"],
      summary: "Get transaction by provider ID and external transaction ID",
      operationId: "getTransactionByExternalId",
      parameters: [
        { name: "providerId", in: "path", required: true, schema: { type: "string" } },
        { name: "externalTransactionId", in: "path", required: true, schema: { type: "string" } },
      ],
      responses: {
        "200": {
          description: "Transaction found",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TransactionResponse" },
            },
          },
        },
        "404": {
          description: "Transaction not found",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
              example: {
                error: {
                  code: "TRANSACTION_NOT_FOUND",
                  failureCode: "TRANSACTION_NOT_FOUND",
                  message: "Transaction not found for provider and external transaction ID",
                },
              },
            },
          },
        },
      },
    },
  },
};

const PRIVATE_PATHS = {
  ...PUBLIC_PATHS,
  "/v1/api/wagering/transactions": {
    ...PUBLIC_PATHS["/v1/api/wagering/transactions"],
    post: {
      ...PUBLIC_PATHS["/v1/api/wagering/transactions"].post,
      description: `Internal and operational view of the wagering transaction execution pipeline. Details row-level pessimistic locking, append-only ledger mutation, outbox event persistence, and asynchronous worker dispatch.

### Primary ACID Execution Pipeline (White-Box Internal Architecture)
\`\`\`
[Partner Game Provider]          [API Gateway]                 [PostgreSQL Engine]              [Outbox Publisher]      [SQS FIFO]
         │                             │                                │                                │                  │
         │─── POST /transactions ─────>│                                │                                │                  │
         │    (idempotencyKey, BET)    │─── Check Rate Limit Quota ─────│                                │                  │
         │                             │─── Compute Canonical SHA-256 ──│                                │                  │
         │                             │                                │                                │                  │
         │                             │─── Check Existing Idempotency >│                                │                  │
         │                             │<── Match? Replay 200 / 409 ────│                                │                  │
         │                             │                                │                                │                  │
         │                             │─── BEGIN TRANSACTION ─────────>│                                │                  │
         │                             │    SELECT wallet FOR UPDATE ───│ (Pessimistic Row Lock)         │                  │
         │                             │    Assert Currency & Balance ──│ (Funds Validation)             │                  │
         │                             │    UPDATE wallets (v2) ───────>│                                │                  │
         │                             │    INSERT ledger (DEBIT) ─────>│ (Immutable Append-Only)       │                  │
         │                             │    INSERT wager_tx (PROCESSED)─│                                │                  │
         │                             │    INSERT outbox_messages ────>│─── Event: wager.tx.processed ─│                  │
         │                             │─── COMMIT TRANSACTION ────────>│                                │                  │
         │<── 201 Created (PROCESSED) ─│                                │                                │                  │
         │                             │                                │─── FOR UPDATE SKIP LOCKED ────>│                  │
         │                             │                                │<── Claimed 50 Messages ────────│                  │
         │                             │                                │                                │─── SendMessage ─>│
         │                             │                                │                                │    (GroupId=id)  │
\`\`\`

### Out-of-Order Reversal Handling (REFUND / ROLLBACK before BET)
\`\`\`
[Partner Game Provider]          [API Gateway]                 [PostgreSQL Engine]              [Pending Ref Worker]
         │                             │                                │                                │
         │─── POST tx (REFUND) ───────>│                                │                                │
         │    (ref: BET-EXT-99)        │─── Referenced BET Exists? ─────│                                │
         │                             │<── Not Found (Arrived Early) ──│                                │
         │                             │                                │                                │
         │                             │─── INSERT wager_tx ───────────>│                                │
         │                             │    (status: PENDING_REFERENCE) │                                │
         │<── 202 Accepted ────────────│                                │                                │
         │    (status: PENDING_REF)    │                                │                                │
         │                             │                                │─── Periodic Backoff Sweep ────>│
         │                             │                                │<── Referenced BET Found! ──────│
         │                             │                                │─── Lock Wallet & Apply Debit ─>│
         │                             │                                │─── Transition to PROCESSED ───>│
\`\`\``,
    },
  },
  "/v1/api/wallets/{id}/reconcile": {
    post: {
      tags: ["Operations & Audit"],
      summary: "Audit and reconcile wallet balance against ledger",
      description: `Enforces the core financial invariant: wallet.balance == sum(wallet_ledger_entries). Locks the wallet exclusively, replays all ledger movements, detects divergence, applies corrective action, and outputs a complete audit report.

\`\`\`
[Auditor / SRE Operator]         [API Gateway]                 [PostgreSQL Engine]
         │                             │                                │
         │─── POST /wallets/:id/reconcile>                              │
         │                             │─── BEGIN TRANSACTION ─────────>│
         │                             │    SELECT wallet FOR UPDATE ───│ (Pessimistic Row Lock)
         │                             │    SELECT SUM(direction*amount)│
         │                             │      FROM ledger entries ─────>│ (Reconstruct From History)
         │                             │<── ledgerSum, walletBalance ───│
         │                             │                                │
         │                             │─── Divergence Detected? ───────│
         │                             │    [Yes]: UPDATE wallet balance│
         │                             │           INSERT audit ledger  │
         │                             │           EMIT divergence log  │
         │                             │    [No]:  Clean Verification   │
         │                             │─── COMMIT TRANSACTION ────────>│
         │<── 200 OK ──────────────────│                                │
         │    {reconciledBalance,      │                                │
         │     hasDivergence: false}   │                                │
\`\`\``,
      operationId: "reconcileWallet",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": {
          description: "Reconciliation completed",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ReconcileResponse" },
              examples: {
                cleanVerification: {
                  summary: "Clean Verification (No Divergence)",
                  value: {
                    walletId: "019488a0-1111-7000-8000-000000000001",
                    currency: "BRL",
                    previousBalance: "450.00",
                    calculatedLedgerBalance: "450.00",
                    reconciledBalance: "450.00",
                    hasDivergence: false,
                    totalLedgerEntries: 2,
                  },
                },
                divergenceCorrected: {
                  summary: "Divergence Detected and Corrected",
                  value: {
                    walletId: "019488a0-1111-7000-8000-000000000001",
                    currency: "BRL",
                    previousBalance: "500.00",
                    calculatedLedgerBalance: "450.00",
                    reconciledBalance: "450.00",
                    hasDivergence: true,
                    totalLedgerEntries: 2,
                  },
                },
              },
            },
          },
        },
        "404": {
          description: "Wallet not found",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
              example: {
                error: {
                  code: "WALLET_NOT_FOUND",
                  failureCode: "WALLET_NOT_FOUND",
                  message: "Wallet '019488a0-0000-0000-0000-000000000000' not found",
                },
              },
            },
          },
        },
      },
    },
  },
  "/health/live": {
    get: {
      tags: ["Observability"],
      summary: "Kubernetes Liveness Probe",
      responses: {
        "200": { description: "Application process is running" },
      },
    },
  },
  "/health/ready": {
    get: {
      tags: ["Observability"],
      summary: "Kubernetes Readiness Probe",
      responses: {
        "200": { description: "PostgreSQL and SQS connectivity healthy" },
        "503": { description: "Service unavailable" },
      },
    },
  },
  "/metrics": {
    get: {
      tags: ["Observability"],
      summary: "Prometheus Telemetry Metrics",
      responses: {
        "200": { description: "Prometheus plaintext metrics" },
      },
    },
  },
};

export const PUBLIC_OPENAPI_SPECIFICATION = {
  openapi: "3.0.3",
  info: {
    title: "Distributed Wagering Processor — Public Partner API",
    version: "1.0.6",
    description:
      "Public specification for Game Providers integrating BET, WIN, LOSS, REFUND, and ROLLBACK wagering operations and player wallets.\n\nLooking for the interactive testing console? [Switch to Swagger UI](/v1/api/docs/swagger).",
    contact: {
      name: "Engineering Team",
      url: "https://github.com/ULYBR/backend-challenge",
    },
  },
  servers: COMMON_SERVERS,
  tags: [
    {
      name: "Wallets",
      description: "Player wallet creation, balance inspection, and ledger extraction",
    },
    {
      name: "Wagering",
      description: "BET, WIN, LOSS, REFUND, and ROLLBACK financial transaction processing",
    },
  ],
  paths: PUBLIC_PATHS,
  components: {
    schemas: SCHEMAS,
  },
};

export const PRIVATE_OPENAPI_SPECIFICATION = {
  openapi: "3.0.3",
  info: {
    title: "Distributed Wagering Processor — Private & Operational Console",
    version: "1.0.6",
    description:
      "Internal and operational specification for site reliability engineers, operations, and technical evaluators. Includes administrative audit and reconciliation, Kubernetes probes, and Prometheus telemetry metrics.\n\nLooking for the partner reference? [Switch to ReDoc](/v1/api/docs).",
    contact: {
      name: "Engineering Team",
      url: "https://github.com/ULYBR/backend-challenge",
    },
  },
  servers: COMMON_SERVERS,
  tags: [
    {
      name: "Wallets",
      description: "Player wallet creation, balance inspection, and ledger extraction",
    },
    {
      name: "Wagering",
      description: "BET, WIN, LOSS, REFUND, and ROLLBACK financial transaction processing",
    },
    {
      name: "Operations & Audit",
      description: "Internal administrative commands and wallet ledger reconciliation",
    },
    {
      name: "Observability",
      description: "Kubernetes liveness/readiness probes and Prometheus telemetry",
    },
  ],
  paths: PRIVATE_PATHS,
  components: {
    schemas: SCHEMAS,
  },
};

@Controller(["docs", "v1/api/docs", "api/v1/docs"])
export class DocsController {
  @Get("public/openapi.json")
  getPublicOpenApiSpec(): typeof PUBLIC_OPENAPI_SPECIFICATION {
    return PUBLIC_OPENAPI_SPECIFICATION;
  }

  @Get("private/openapi.json")
  getPrivateOpenApiSpec(): typeof PRIVATE_OPENAPI_SPECIFICATION {
    return PRIVATE_OPENAPI_SPECIFICATION;
  }

  @Get("openapi.json")
  getOpenApiSpec(): typeof PUBLIC_OPENAPI_SPECIFICATION {
    return PUBLIC_OPENAPI_SPECIFICATION;
  }

  @Get()
  getInteractiveDocView(@Res() res: Response): void {
    res.sendFile(join(process.cwd(), "public/docs/index.html"));
  }

  @Get("swagger")
  getSwaggerView(@Res() res: Response): void {
    res.sendFile(join(process.cwd(), "public/docs/swagger.html"));
  }

  @Get("private")
  getPrivateDocView(@Res() res: Response): void {
    this.getSwaggerView(res);
  }
}
