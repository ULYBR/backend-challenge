import "reflect-metadata";
import type { StructuredLoggerPort } from "@application/ports/structured-logger.port";
import { TOKENS } from "@application/ports/tokens";
import { AppEnv, parseEnv } from "@infrastructure/config/env";
import { SqsQueueRegistry } from "@infrastructure/messaging/sqs.module";
import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "@src/app.module";
import { Logger } from "nestjs-pino";

type StartupStrategy = (
  app: INestApplication,
  env: AppEnv,
  logger: StructuredLoggerPort,
) => Promise<void>;

const STARTUP_STRATEGIES: Record<"http" | "workerOnly", StartupStrategy> = {
  http: async (app, env, logger) => {
    await app.listen(env.PORT, "0.0.0.0");
    logger.info(
      {
        event: "app.bootstrap.listening",
        port: env.PORT,
        roles: Array.from(env.activeRoles),
      },
      "Distributed Wagering Processor listening",
    );
  },
  workerOnly: async (app, env, logger) => {
    await app.init();
    logger.info(
      {
        event: "app.bootstrap.worker_initialized",
        roles: Array.from(env.activeRoles),
      },
      "Distributed Wagering Processor worker roles initialized",
    );
  },
};

export async function bootstrap(): Promise<INestApplication> {
  const env = parseEnv();
  const app = await NestFactory.create(AppModule.register(env), {
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  const sqsRegistry = app.get<SqsQueueRegistry>(TOKENS.SQS_QUEUE_REGISTRY);
  await sqsRegistry.ensureQueues();

  const structuredLogger = app.get<StructuredLoggerPort>(TOKENS.LOGGER);
  const mode = env.activeRoles.has("api") ? "http" : "workerOnly";
  await STARTUP_STRATEGIES[mode](app, env, structuredLogger);

  return app;
}

if (import.meta.main) {
  bootstrap().catch((err) => {
    console.error("Fatal error during application bootstrap:", err);
    process.exit(1);
  });
}
