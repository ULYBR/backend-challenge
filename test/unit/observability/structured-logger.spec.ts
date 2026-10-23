import { describe, expect, it, mock } from "bun:test";
import { parseEnv } from "@infrastructure/config/env";
import { CorrelationContext } from "@infrastructure/observability/correlation-context";
import { PinoStructuredLoggerAdapter } from "@infrastructure/observability/structured-logger.adapter";
import type { PinoLogger } from "nestjs-pino";

describe("PinoStructuredLoggerAdapter & CorrelationContext", () => {
  it("propagates telemetry context via AsyncLocalStorage and strips financial keys", () => {
    const loggedCalls: Array<{ obj: Record<string, unknown>; msg: string | undefined }> = [];
    const fakePino = {
      info: mock((obj: Record<string, unknown>, msg?: string) => {
        loggedCalls.push({ obj, msg });
      }),
    } as unknown as PinoLogger;

    const env = parseEnv({ INSTANCE_ID: "node-alpha" });
    const logger = new PinoStructuredLoggerAdapter(fakePino, env);

    CorrelationContext.run(
      {
        correlationId: "corr-123",
        messageId: "msg-456",
        walletId: "wal-789",
        providerId: "prov-a",
      },
      () => {
        logger.info({
          event: "wager.transaction.processed",
          transactionId: "tx-001",
          kind: "BET",
          money: { amount: "999.00", currency: "BRL" },
          balance: "1000.00",
          amount: "999.00",
        });
      },
    );

    expect(loggedCalls.length).toBe(1);
    const call = loggedCalls[0];
    expect(call?.obj.event).toBe("wager.transaction.processed");
    expect(call?.obj.instanceId).toBe("node-alpha");
    expect(call?.obj.correlationId).toBe("corr-123");
    expect(call?.obj.messageId).toBe("msg-456");
    expect(call?.obj.walletId).toBe("wal-789");
    expect(call?.obj.providerId).toBe("prov-a");
    expect(call?.obj.transactionId).toBe("tx-001");
    expect(call?.obj.money).toBeUndefined();
    expect(call?.obj.balance).toBeUndefined();
    expect(call?.obj.amount).toBeUndefined();
  });
});
