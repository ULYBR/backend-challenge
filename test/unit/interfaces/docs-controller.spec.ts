import { describe, expect, it } from "bun:test";
import { DocsController } from "@interfaces/http/docs.controller";
import type { Response } from "express";

describe("DocsController (Interactive Web OpenAPI Documentation)", () => {
  const controller = new DocsController();

  it("serves complete OpenAPI 3.1 JSON specification with all routes and schemas", () => {
    const spec = controller.getOpenApiSpec();

    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toBe("Distributed Wagering Processor API");
    expect(spec.paths["/api/v1/wallets"]).toBeDefined();
    expect(spec.paths["/api/v1/wagering/transactions"]).toBeDefined();
    expect(spec.paths["/api/v1/wallets/{id}/ledger"]).toBeDefined();
    expect(spec.paths["/api/v1/wallets/{id}/reconcile"]).toBeDefined();
    expect(spec.paths["/health/live"]).toBeDefined();
    expect(spec.paths["/metrics"]).toBeDefined();
    expect(spec.components.schemas.ProcessTransactionRequest).toBeDefined();
  });

  it("serves ReDoc 3-column reference view matching Zé Delivery standard", () => {
    let sentHtml = "";
    const mockRes = {
      send: (body: string) => {
        sentHtml = body;
      },
    } as unknown as Response;

    controller.getInteractiveDocView(mockRes);

    expect(sentHtml).toContain("<!DOCTYPE html>");
    expect(sentHtml).toContain("<redoc");
    expect(sentHtml).toContain("redoc.standalone.js");
    expect(sentHtml).toContain("/docs/swagger");
    expect(sentHtml).toContain("/docs/openapi.json");
    expect(sentHtml).toContain("Distributed Wagering Processor");
  });

  it("serves Swagger UI HTML view at /docs/swagger", () => {
    let sentHtml = "";
    const mockRes = {
      send: (body: string) => {
        sentHtml = body;
      },
    } as unknown as Response;

    controller.getSwaggerView(mockRes);

    expect(sentHtml).toContain("<!DOCTYPE html>");
    expect(sentHtml).toContain("swagger-ui");
    expect(sentHtml).toContain("/docs/openapi.json");
    expect(sentHtml).toContain("SwaggerUIBundle");
  });
});
