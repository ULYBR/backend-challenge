import { describe, expect, it } from "bun:test";
import { DocsController } from "@interfaces/http/docs.controller";
import type { Response } from "express";

describe("DocsController (Interactive Web OpenAPI Documentation)", () => {
  const controller = new DocsController();

  it("serves public OpenAPI specification isolating partner routes from internal ops", () => {
    const spec = controller.getPublicOpenApiSpec();

    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toContain("Public Partner API");
    expect(spec.paths["/v1/api/wallets"]).toBeDefined();
    expect(spec.paths["/v1/api/wagering/transactions"]).toBeDefined();
    expect(spec.paths["/v1/api/wallets/{id}/ledger"]).toBeDefined();
    const rawPaths = spec.paths as Record<string, unknown>;
    expect(rawPaths["/v1/api/wallets/{id}/reconcile"]).toBeUndefined();
    expect(rawPaths["/health/live"]).toBeUndefined();
    expect(rawPaths["/metrics"]).toBeUndefined();
  });

  it("serves private & operational OpenAPI specification containing all audit and telemetry routes", () => {
    const spec = controller.getPrivateOpenApiSpec();

    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toContain("Private & Operational Console");
    expect(spec.paths["/v1/api/wallets"]).toBeDefined();
    expect(spec.paths["/v1/api/wagering/transactions"]).toBeDefined();
    expect(spec.paths["/v1/api/wallets/{id}/reconcile"]).toBeDefined();
    expect(spec.paths["/health/live"]).toBeDefined();
    expect(spec.paths["/metrics"]).toBeDefined();
  });

  it("serves ReDoc public 3-column reference view pointing to public OpenAPI spec", () => {
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
    expect(sentHtml).toContain("/v1/api/docs/swagger");
    expect(sentHtml).toContain("/v1/api/docs/public/openapi.json");
    expect(sentHtml).toContain("Public Partner Reference");
  });

  it("serves Swagger UI private operational view pointing to private OpenAPI spec", () => {
    let sentHtml = "";
    const mockRes = {
      send: (body: string) => {
        sentHtml = body;
      },
    } as unknown as Response;

    controller.getSwaggerView(mockRes);

    expect(sentHtml).toContain("<!DOCTYPE html>");
    expect(sentHtml).toContain("swagger-ui");
    expect(sentHtml).toContain("/v1/api/docs/private/openapi.json");
    expect(sentHtml).toContain("SwaggerUIBundle");
    expect(sentHtml).toContain("Private & Operational Console");
  });
});
