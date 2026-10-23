import { describe, expect, it } from "bun:test";
import { DocsController } from "@interfaces/http/docs.controller";
import type { Response } from "express";

describe("DocsController (Interactive Web OpenAPI Documentation)", () => {
  const controller = new DocsController();

  it("serves public OpenAPI specification isolating partner routes from internal ops", () => {
    const spec = controller.getPublicOpenApiSpec();

    expect(spec.openapi).toBe("3.0.3");
    expect(spec.info.version).toBe("1.0.9");
    expect(spec.info.title).toContain("Public Partner API");
    expect(spec.paths["/v1/api/wallets"]).toBeDefined();
    expect(spec.paths["/v1/api/wallets"].post.description).toContain("wallet-flow.svg");
    expect(spec.paths["/v1/api/wallets"].post.description).not.toContain("```");
    expect(spec.paths["/v1/api/wallets"].post.description).not.toContain("INSERT wallets");
    expect(spec.paths["/v1/api/wallets"].post.description).not.toContain("outbox_messages");
    expect(spec.paths["/v1/api/wagering/transactions"]).toBeDefined();
    expect(spec.paths["/v1/api/wagering/transactions"].post.description).toContain(
      "wagering-flow.svg",
    );
    expect(spec.paths["/v1/api/wagering/transactions"].post.description).not.toContain("```");
    expect(spec.paths["/v1/api/wagering/transactions"].post.description).not.toContain(
      "SELECT wallet FOR UPDATE",
    );
    expect(spec.paths["/v1/api/wallets/{id}/ledger"]).toBeDefined();
    expect(spec.paths["/v1/api/wallets/{id}/ledger"].get.description).toContain("ledger-flow.svg");
    expect(spec.paths["/v1/api/wallets/{id}/ledger"].get.description).not.toContain("```");
    expect(spec.paths["/v1/api/wallets/{id}/ledger"].get.description).not.toContain(
      "SELECT FROM ledger",
    );
    const rawPaths = spec.paths as Record<string, unknown>;
    expect(rawPaths["/v1/api/wallets/{id}/reconcile"]).toBeUndefined();
    expect(rawPaths["/health/live"]).toBeUndefined();
    expect(rawPaths["/metrics"]).toBeUndefined();
  });

  it("serves private & operational OpenAPI specification containing all audit and telemetry routes", () => {
    const spec = controller.getPrivateOpenApiSpec();

    expect(spec.openapi).toBe("3.0.3");
    expect(spec.info.version).toBe("1.0.9");
    expect(spec.info.title).toContain("Private & Operational Console");
    expect(spec.paths["/v1/api/wallets"]).toBeDefined();
    expect(spec.paths["/v1/api/wagering/transactions"]).toBeDefined();
    const privateWagerPost = spec.paths["/v1/api/wagering/transactions"].post;
    expect(privateWagerPost.description).toContain(
      "Primary ACID Execution Pipeline (White-Box Internal Architecture)",
    );
    expect(privateWagerPost.description).toContain("wagering-internal-flow.svg");
    expect(privateWagerPost.description).toContain("SELECT wallet FOR UPDATE");
    expect(privateWagerPost.description).toContain("outbox_messages");
    expect(privateWagerPost.description).toContain("FOR UPDATE SKIP LOCKED");
    expect(privateWagerPost.description).not.toContain("```");
    expect(spec.paths["/v1/api/wallets/{id}/reconcile"]).toBeDefined();
    const reconcilePost = (
      spec.paths["/v1/api/wallets/{id}/reconcile"] as { post: { description: string } }
    ).post;
    expect(reconcilePost.description).toContain("[Auditor / SRE Operator]");
    expect(reconcilePost.description).toContain("reconcile-flow.svg");
    expect(reconcilePost.description).toContain("SELECT wallet FOR UPDATE");
    expect(reconcilePost.description).not.toContain("```");
    const reconcileResponses = (
      spec.paths["/v1/api/wallets/{id}/reconcile"] as {
        post: {
          responses: {
            "200": {
              content: {
                "application/json": {
                  examples: Record<string, unknown>;
                };
              };
            };
          };
        };
      }
    ).post.responses;
    expect(
      reconcileResponses["200"].content["application/json"].examples.cleanVerification,
    ).toBeDefined();
    expect(
      reconcileResponses["200"].content["application/json"].examples.divergenceCorrected,
    ).toBeDefined();
    expect(spec.paths["/health/live"]).toBeDefined();
    expect(spec.paths["/metrics"]).toBeDefined();
  });

  it("serves ReDoc public 3-column reference view pointing to public HTML file", () => {
    let sentPath = "";
    const mockRes = {
      sendFile: (filePath: string) => {
        sentPath = filePath;
      },
    } as unknown as Response;

    controller.getInteractiveDocView(mockRes);

    expect(sentPath).toContain("public/docs/index.html");
  });

  it("serves Swagger UI private operational view pointing to private HTML file", () => {
    let sentPath = "";
    const mockRes = {
      sendFile: (filePath: string) => {
        sentPath = filePath;
      },
    } as unknown as Response;

    controller.getSwaggerView(mockRes);

    expect(sentPath).toContain("public/docs/swagger.html");
  });

  it("serves SVG sequence diagram assets with correct mime type and path", () => {
    let sentPath = "";
    let contentType = "";
    const mockRes = {
      setHeader: (name: string, value: string) => {
        if (name.toLowerCase() === "content-type") {
          contentType = value;
        }
      },
      sendFile: (filePath: string) => {
        sentPath = filePath;
      },
    } as unknown as Response;

    controller.getDiagramAsset("wagering-flow.svg", mockRes);

    expect(contentType).toContain("image/svg+xml");
    expect(sentPath).toContain("public/docs/diagrams/wagering-flow.svg");
  });
});
