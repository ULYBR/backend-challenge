import { describe, expect, it } from "bun:test";
import { DocsController } from "@interfaces/http/docs.controller";
import type { Response } from "express";

describe("DocsController (Interactive Web OpenAPI Documentation)", () => {
  const controller = new DocsController();

  it("serves complete OpenAPI 3.1 JSON specification with all routes and schemas", () => {
    const spec = controller.getOpenApiSpec();

    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toBe("Distributed Wagering Processor API");
    expect(spec.paths["/wallets"]).toBeDefined();
    expect(spec.paths["/wagering/transactions"]).toBeDefined();
    expect(spec.paths["/wallets/{id}/ledger"]).toBeDefined();
    expect(spec.paths["/wallets/{id}/reconcile"]).toBeDefined();
    expect(spec.paths["/health/live"]).toBeDefined();
    expect(spec.paths["/metrics"]).toBeDefined();
    expect(spec.components.schemas.ProcessTransactionRequest).toBeDefined();
  });

  it("serves interactive HTML view with Scalar API reference tag", () => {
    let sentHtml = "";
    const mockRes = {
      send: (body: string) => {
        sentHtml = body;
      },
    } as unknown as Response;

    controller.getInteractiveDocView(mockRes);

    expect(sentHtml).toContain("<!doctype html>");
    expect(sentHtml).toContain("api-reference");
    expect(sentHtml).toContain("/docs/openapi.json");
    expect(sentHtml).toContain("Distributed Wagering Processor");
  });
});
