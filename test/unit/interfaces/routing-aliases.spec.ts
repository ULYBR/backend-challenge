import { describe, expect, it } from "bun:test";
import { DocsController } from "@interfaces/http/docs.controller";

describe("DocsController Public & Private Segregation", () => {
  const controller = new DocsController();

  it("serves public OpenAPI spec without internal operational endpoints", () => {
    const spec = controller.getPublicOpenApiSpec();
    const rawPaths = spec.paths as Record<string, unknown>;

    expect(spec.info.title).toContain("Public Partner API");
    expect(spec.paths["/v1/api/wallets"]).toBeDefined();
    expect(spec.paths["/v1/api/wagering/transactions"]).toBeDefined();
    expect(rawPaths["/v1/api/wallets/{id}/reconcile"]).toBeUndefined();
    expect(rawPaths["/health/live"]).toBeUndefined();
    expect(rawPaths["/health/ready"]).toBeUndefined();
    expect(rawPaths["/metrics"]).toBeUndefined();
  });

  it("serves private & operational OpenAPI spec with all internal and audit endpoints", () => {
    const spec = controller.getPrivateOpenApiSpec();

    expect(spec.info.title).toContain("Private & Operational Console");
    expect(spec.paths["/v1/api/wallets"]).toBeDefined();
    expect(spec.paths["/v1/api/wagering/transactions"]).toBeDefined();
    expect(spec.paths["/v1/api/wallets/{id}/reconcile"]).toBeDefined();
    expect(spec.paths["/health/live"]).toBeDefined();
    expect(spec.paths["/health/ready"]).toBeDefined();
    expect(spec.paths["/metrics"]).toBeDefined();
  });
});
