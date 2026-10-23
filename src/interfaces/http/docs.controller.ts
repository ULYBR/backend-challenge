import { Controller, Get, Header, Res } from "@nestjs/common";
import type { Response } from "express";

const OPENAPI_SPECIFICATION = {
  openapi: "3.1.0",
  info: {
    title: "Distributed Wagering Processor API",
    version: "1.0.4",
    description:
      "Production-ready Distributed Wagering Processor following Hexagonal Architecture, Append-Only Ledger, Transactional Outbox, SQS FIFO messaging, and OWASP API Security defenses.",
    contact: {
      name: "Engineering Team",
      url: "https://github.com/ULYBR/backend-challenge",
    },
  },
  servers: [
    {
      url: "http://localhost:3000",
      description: "Local Development Server",
    },
  ],
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
      name: "Observability",
      description: "Kubernetes liveness/readiness probes and Prometheus telemetry",
    },
  ],
  paths: {
    "/wallets": {
      post: {
        tags: ["Wallets"],
        summary: "Open a new player wallet",
        description:
          "Creates a new player wallet with positive initialBalance, creating an OPENING transaction and ledger entry at version 1.",
        operationId: "openWallet",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/OpenWalletRequest" },
              example: {
                playerId: "player-100",
                currency: "BRL",
                initialBalance: "500.00",
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Wallet opened successfully",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WalletResponse" },
              },
            },
          },
          "400": { description: "Invalid input or monetary format" },
          "409": { description: "Wallet already exists for this playerId and currency" },
          "429": { description: "Rate limit exceeded (Too Many Requests)" },
        },
      },
    },
    "/wallets/{id}": {
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
            description: "Wallet identifier (e.g., w-123)",
          },
        ],
        responses: {
          "200": {
            description: "Wallet retrieved successfully",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WalletResponse" },
              },
            },
          },
          "404": { description: "Wallet not found" },
        },
      },
    },
    "/wallets/{id}/ledger": {
      get: {
        tags: ["Wallets"],
        summary: "List immutable wallet ledger entries",
        description:
          "Extracts immutable ledger entries using deterministic base64 keyset cursor pagination.",
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
            description: "Opaque cursor for keyset pagination",
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
              },
            },
          },
          "400": { description: "Malformed pagination cursor" },
          "404": { description: "Wallet not found" },
        },
      },
    },
    "/wallets/{id}/reconcile": {
      post: {
        tags: ["Wallets"],
        summary: "Audit and reconcile wallet balance against ledger",
        description:
          "Enforces the mandatory invariant: wallet.balance == sum(ledger). Locks wallet and corrects any divergence.",
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
              },
            },
          },
          "404": { description: "Wallet not found" },
        },
      },
    },
    "/wagering/transactions": {
      post: {
        tags: ["Wagering"],
        summary: "Process a wagering transaction (BET, WIN, LOSS, REFUND, ROLLBACK)",
        description:
          "Processes financial betting operations with persistent idempotency, pessimistic row lock, outbox events, and out-of-order resolution.",
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
                  summary: "Place a Bet",
                  value: {
                    walletId: "w-100",
                    providerId: "provider-evolution",
                    externalTransactionId: "tx-bet-001",
                    idempotencyKey: "idem-bet-001",
                    kind: "BET",
                    amount: "50.00",
                    currency: "BRL",
                  },
                },
                win: {
                  summary: "Settle a Win",
                  value: {
                    walletId: "w-100",
                    providerId: "provider-evolution",
                    externalTransactionId: "tx-win-001",
                    idempotencyKey: "idem-win-001",
                    kind: "WIN",
                    amount: "150.00",
                    currency: "BRL",
                  },
                },
                refund: {
                  summary: "Refund a Bet",
                  value: {
                    walletId: "w-100",
                    providerId: "provider-evolution",
                    externalTransactionId: "tx-ref-001",
                    idempotencyKey: "idem-ref-001",
                    kind: "REFUND",
                    amount: "50.00",
                    currency: "BRL",
                    referenceTransactionId: "tx-bet-001",
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Transaction PROCESSED successfully" },
          "200": { description: "Idempotent replay (matching payloadHash)" },
          "202": { description: "ACCEPTED with PENDING_REFERENCE (waiting for referenced BET)" },
          "400": { description: "Validation error" },
          "409": { description: "Idempotency conflict (same key with differing payload)" },
          "422": {
            description:
              "Business rejection (e.g., INSUFFICIENT_FUNDS, REFERENCE_ALREADY_REVERSED)",
          },
          "429": { description: "Rate limit exceeded (Too Many Requests)" },
        },
      },
    },
    "/wagering/transactions/{id}": {
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
          "200": { description: "Transaction found" },
          "404": { description: "Transaction not found" },
        },
      },
    },
    "/wagering/transactions/external/{providerId}/{externalTransactionId}": {
      get: {
        tags: ["Wagering"],
        summary: "Get transaction by provider ID and external transaction ID",
        operationId: "getTransactionByExternalId",
        parameters: [
          { name: "providerId", in: "path", required: true, schema: { type: "string" } },
          { name: "externalTransactionId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Transaction found" },
          "404": { description: "Transaction not found" },
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
  },
  components: {
    schemas: {
      OpenWalletRequest: {
        type: "object",
        required: ["playerId", "currency", "initialBalance"],
        properties: {
          playerId: { type: "string", example: "player-100" },
          currency: { type: "string", example: "BRL" },
          initialBalance: { type: "string", example: "500.00" },
        },
      },
      WalletResponse: {
        type: "object",
        properties: {
          id: { type: "string", example: "w-100" },
          playerId: { type: "string", example: "player-100" },
          currency: { type: "string", example: "BRL" },
          balance: { type: "string", example: "500.00" },
          version: { type: "integer", example: 1 },
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
          walletId: { type: "string" },
          providerId: { type: "string" },
          externalTransactionId: { type: "string" },
          idempotencyKey: { type: "string" },
          kind: { type: "string", enum: ["BET", "WIN", "LOSS", "REFUND", "ROLLBACK"] },
          amount: { type: "string", example: "50.00" },
          currency: { type: "string", example: "BRL" },
          referenceTransactionId: { type: "string" },
        },
      },
      LedgerPageResponse: {
        type: "object",
        properties: {
          entries: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                walletId: { type: "string" },
                walletVersion: { type: "integer" },
                transactionId: { type: "string" },
                direction: { type: "string", enum: ["CREDIT", "DEBIT"] },
                amount: { type: "string" },
                balanceBefore: { type: "string" },
                balanceAfter: { type: "string" },
                createdAt: { type: "string" },
              },
            },
          },
          nextCursor: { type: "string", nullable: true },
          hasMore: { type: "boolean" },
        },
      },
      ReconcileResponse: {
        type: "object",
        properties: {
          walletId: { type: "string" },
          currency: { type: "string" },
          previousBalance: { type: "string" },
          calculatedLedgerBalance: { type: "string" },
          reconciledBalance: { type: "string" },
          hasDivergence: { type: "boolean" },
          totalLedgerEntries: { type: "integer" },
        },
      },
    },
  },
};

@Controller("docs")
export class DocsController {
  @Get("openapi.json")
  getOpenApiSpec(): typeof OPENAPI_SPECIFICATION {
    return OPENAPI_SPECIFICATION;
  }

  @Get()
  @Header("Content-Type", "text/html; charset=utf-8")
  getInteractiveDocView(@Res() res: Response): void {
    const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Distributed Wagering Processor — API Reference</title>
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎰</text></svg>" />
    <style>
      body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; }
      #fallback { display: none; padding: 32px; max-width: 900px; margin: 0 auto; }
      .badge { background: #3b82f6; color: white; padding: 4px 10px; border-radius: 6px; font-weight: bold; font-size: 12px; }
      .endpoint { background: #1e293b; border-radius: 8px; padding: 16px; margin: 16px 0; border: 1px solid #334155; }
      code { background: #020617; padding: 2px 6px; border-radius: 4px; font-family: monospace; color: #38bdf8; }
    </style>
  </head>
  <body>
    <div id="fallback">
      <h1>🎰 Distributed Wagering Processor API</h1>
      <p>Interactive documentation powered by OpenAPI 3.1. Raw JSON specification available at <a href="/docs/openapi.json" style="color:#38bdf8">/docs/openapi.json</a>.</p>
      <div class="endpoint"><span class="badge">POST</span> <code>/wallets</code> — Criar carteira</div>
      <div class="endpoint"><span class="badge">POST</span> <code>/wagering/transactions</code> — Processar aposta (BET, WIN, LOSS, REFUND, ROLLBACK)</div>
      <div class="endpoint"><span class="badge">GET</span> <code>/wallets/:id/ledger</code> — Extrato contábil com cursor pagination</div>
      <div class="endpoint"><span class="badge">POST</span> <code>/wallets/:id/reconcile</code> — Auditoria de integridade financeira</div>
      <div class="endpoint"><span class="badge">GET</span> <code>/health/ready</code> — Healthcheck readiness</div>
      <div class="endpoint"><span class="badge">GET</span> <code>/metrics</code> — Métricas Prometheus</div>
    </div>
    <script id="api-reference" data-url="/docs/openapi.json"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference" onerror="document.getElementById('fallback').style.display='block';"></script>
  </body>
</html>`;

    res.send(html);
  }
}
