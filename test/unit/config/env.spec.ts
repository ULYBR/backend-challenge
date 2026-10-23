import { describe, expect, it } from "bun:test";
import { APP_ROLES, parseEnv, resolveActiveRoles } from "@infrastructure/config/env";

describe("Environment configuration & APP_ROLE topology (ADR-0002 / ADR-0006)", () => {
  it("resolves 'all' into all 4 application roles", () => {
    const roles = resolveActiveRoles("all");
    expect(Array.from(roles)).toEqual([...APP_ROLES]);
  });

  it("resolves comma-separated subsets of roles", () => {
    const roles = resolveActiveRoles("api, outbox");
    expect(roles.has("api")).toBe(true);
    expect(roles.has("outbox")).toBe(true);
    expect(roles.has("consumer")).toBe(false);
    expect(roles.has("scheduler")).toBe(false);
  });

  it("rejects unknown role names", () => {
    expect(() => resolveActiveRoles("api,unknown")).toThrow(/Invalid APP_ROLE/);
    expect(() => resolveActiveRoles("   ")).toThrow(/Invalid APP_ROLE/);
  });

  it("parses defaults cleanly when given minimal env", () => {
    const env = parseEnv({});
    expect(env.PORT).toBe(3000);
    expect(env.SQS_WAGER_QUEUE_NAME).toBe("wager-transactions.fifo");
    expect(env.SQS_WAGER_DLQ_NAME).toBe("wager-transactions-dlq.fifo");
    expect(env.activeRoles.size).toBe(4);
  });
});
