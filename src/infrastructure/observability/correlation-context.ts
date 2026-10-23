import { AsyncLocalStorage } from "node:async_hooks";
import type { LogTelemetryContext } from "@application/ports/structured-logger.port";

const storage = new AsyncLocalStorage<LogTelemetryContext>();

export class CorrelationContext {
  private constructor() {}

  static run<T>(context: LogTelemetryContext, fn: () => T): T {
    const parent = storage.getStore() ?? {};
    return storage.run({ ...parent, ...context }, fn);
  }

  static current(): LogTelemetryContext {
    return storage.getStore() ?? {};
  }

  static get(): LogTelemetryContext | undefined {
    return storage.getStore();
  }
}
