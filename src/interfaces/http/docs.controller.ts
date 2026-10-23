import { Controller, Get, Header, Res } from "@nestjs/common";
import type { Response } from "express";

const SCHEMAS = {
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
  "/v1/api/wallets/{id}/ledger": {
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
  "/v1/api/wagering/transactions": {
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
          description: "Business rejection (e.g., INSUFFICIENT_FUNDS, REFERENCE_ALREADY_REVERSED)",
        },
        "429": { description: "Rate limit exceeded (Too Many Requests)" },
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
        "200": { description: "Transaction found" },
        "404": { description: "Transaction not found" },
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
        "200": { description: "Transaction found" },
        "404": { description: "Transaction not found" },
      },
    },
  },
};

const PRIVATE_PATHS = {
  ...PUBLIC_PATHS,
  "/v1/api/wallets/{id}/reconcile": {
    post: {
      tags: ["Operations & Audit"],
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
  openapi: "3.1.0",
  info: {
    title: "Distributed Wagering Processor — Public Partner API",
    version: "1.0.6",
    description:
      "Public specification for Game Providers integrating BET, WIN, LOSS, REFUND, and ROLLBACK wagering operations and player wallets.",
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
  openapi: "3.1.0",
  info: {
    title: "Distributed Wagering Processor — Private & Operational Console",
    version: "1.0.6",
    description:
      "Internal and operational specification for site reliability engineers, operations, and technical evaluators. Includes administrative audit and reconciliation, Kubernetes probes, and Prometheus telemetry metrics.",
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
  @Header("Content-Type", "text/html; charset=utf-8")
  getInteractiveDocView(@Res() res: Response): void {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Distributed Wagering Processor API — Public Partner Reference</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎰</text></svg>" />
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&family=Roboto:wght@300;400;500;700&display=swap" rel="stylesheet" />
  <style>
    body { margin: 0; padding: 0; }
    .top-bar-nav { background: #0f172a; padding: 12px 28px; display: flex; justify-content: space-between; align-items: center; color: #f8fafc; box-shadow: 0 2px 8px rgba(0,0,0,0.25); position: sticky; top: 0; z-index: 1000; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .top-bar-nav .brand { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 15px; }
    .top-bar-nav .brand span { color: #38bdf8; font-weight: 500; font-size: 13px; }
    .top-bar-nav .links { display: flex; align-items: center; gap: 20px; }
    .top-bar-nav a { color: #38bdf8; text-decoration: none; font-weight: 600; font-size: 13px; transition: color 0.15s; }
    .top-bar-nav a:hover { color: #ffffff; text-decoration: underline; }
    .top-bar-nav .interactive-btn { background: #2563eb; color: #ffffff !important; padding: 6px 14px; border-radius: 6px; text-decoration: none !important; font-weight: 600; font-size: 13px; display: inline-flex; align-items: center; gap: 6px; }
    .top-bar-nav .interactive-btn:hover { background: #1d4ed8; }
  </style>
</head>
<body>
  <div class="top-bar-nav">
    <div class="brand">
      🎰 Distributed Wagering Processor API <span>Public Partner Reference (v1)</span>
    </div>
    <div class="links">
      <a href="/v1/api/docs/swagger" class="interactive-btn">🔒 Private & Ops Console (Swagger UI)</a>
      <a href="/v1/api/docs/public/openapi.json" target="_blank">Public OpenAPI (JSON)</a>
    </div>
  </div>
  <redoc spec-url="/v1/api/docs/public/openapi.json" expand-responses="200,201" theme='{"colors":{"primary":{"main":"#2563eb"}},"typography":{"headings":{"fontFamily":"Montserrat, sans-serif"}}}'></redoc>
  <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
</body>
</html>`;

    res.send(html);
  }

  @Get("swagger")
  @Header("Content-Type", "text/html; charset=utf-8")
  getSwaggerView(@Res() res: Response): void {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Distributed Wagering Processor — Private & Operational Console</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎰</text></svg>" />
  <style>
    body { margin: 0; background: #fafafa; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .top-bar-nav { background: #0f172a; padding: 14px 28px; display: flex; justify-content: space-between; align-items: center; color: #f8fafc; box-shadow: 0 2px 8px rgba(0,0,0,0.2); }
    .top-bar-nav a { color: #38bdf8; text-decoration: none; font-weight: 600; font-size: 14px; margin-left: 20px; }
    .top-bar-nav a:hover { text-decoration: underline; color: #ffffff; }
    .swagger-ui .topbar { display: none; }
  </style>
</head>
<body>
  <div class="top-bar-nav">
    <span>🔒 <strong>Distributed Wagering Processor</strong> — Private & Operational Console (Swagger UI)</span>
    <div>
      <a href="/v1/api/docs">📖 Public Partner Reference (ReDoc)</a>
      <a href="/v1/api/docs/private/openapi.json" target="_blank">Private OpenAPI (JSON)</a>
    </div>
  </div>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js" crossorigin></script>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-standalone-preset.js" crossorigin></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '/v1/api/docs/private/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        layout: "BaseLayout"
      });
    };
  </script>
</body>
</html>`;

    res.send(html);
  }

  @Get("private")
  @Header("Content-Type", "text/html; charset=utf-8")
  getPrivateDocView(@Res() res: Response): void {
    this.getSwaggerView(res);
  }
}
