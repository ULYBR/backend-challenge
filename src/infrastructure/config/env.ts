import { z } from "zod";

export const APP_ROLES = ["api", "consumer", "outbox", "scheduler"] as const;
export type AppRole = (typeof APP_ROLES)[number];

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  APP_ROLE: z.string().min(1).default("all"),
  INSTANCE_ID: z.string().min(1).default("local-1"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgres://wagering:wagering@localhost:5433/wagering_processor"),
  DB_HOST: z.string().min(1).default("localhost"),
  DB_PORT: z.coerce.number().int().positive().default(5433),
  DB_USER: z.string().min(1).default("wagering"),
  DB_PASSWORD: z.string().min(1).default("wagering"),
  DB_NAME: z.string().min(1).default("wagering_processor"),
  DB_POOL_MIN: z.coerce.number().int().nonnegative().default(2),
  DB_POOL_MAX: z.coerce.number().int().positive().default(20),
  DB_LOCK_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  AWS_REGION: z.string().min(1).default("us-east-1"),
  AWS_ACCESS_KEY_ID: z.string().min(1).default("test"),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).default("test"),
  AWS_ENDPOINT_URL: z.string().url().default("http://localhost:4567"),
  SQS_WAGER_QUEUE_NAME: z.string().min(1).default("wager-transactions.fifo"),
  SQS_WAGER_DLQ_NAME: z.string().min(1).default("wager-transactions-dlq.fifo"),
  SQS_EVENTS_QUEUE_NAME: z.string().min(1).default("wallet-events.fifo"),
  SQS_CONSUMER_NAME: z.string().min(1).default("wager-transactions-consumer"),
  SQS_MAX_RECEIVE_COUNT: z.coerce.number().int().min(1).max(100).default(5),
  SQS_VISIBILITY_TIMEOUT_SEC: z.coerce.number().int().min(1).max(43200).default(30),
  SQS_WAIT_TIME_SEC: z.coerce.number().int().min(0).max(20).default(5),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(500),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().default(50),
  OUTBOX_LEASE_MS: z.coerce.number().int().positive().default(15000),
  PENDING_REF_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  PENDING_REF_MAX_ATTEMPTS: z.coerce.number().int().positive().default(8),
});

export type AppEnv = z.infer<typeof envSchema> & {
  readonly activeRoles: ReadonlySet<AppRole>;
};

export function resolveActiveRoles(roleSpec: string): ReadonlySet<AppRole> {
  const parts = roleSpec
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    throw new Error(
      "Invalid APP_ROLE: must specify 'all' or at least one of api,consumer,outbox,scheduler",
    );
  }

  if (parts.includes("all")) {
    return new Set<AppRole>(APP_ROLES);
  }

  const active = new Set<AppRole>();
  for (const part of parts) {
    if (!APP_ROLES.includes(part as AppRole)) {
      throw new Error(
        `Invalid APP_ROLE value '${part}'. Allowed values: all, ${APP_ROLES.join(", ")}`,
      );
    }
    active.add(part as AppRole);
  }

  return active;
}

export function parseEnv(rawEnv: Record<string, string | undefined> = process.env): AppEnv {
  const parsed = envSchema.parse(rawEnv);
  const activeRoles = resolveActiveRoles(parsed.APP_ROLE);
  return {
    ...parsed,
    activeRoles,
  };
}
