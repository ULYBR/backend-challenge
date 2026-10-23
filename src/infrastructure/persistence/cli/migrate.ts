import "reflect-metadata";
import { parseEnv } from "@infrastructure/config/env";
import { buildMikroOrmOptions } from "@infrastructure/persistence/mikro-orm.config";
import type { IMigrator } from "@mikro-orm/core";
import { MikroORM } from "@mikro-orm/postgresql";

type MigrationCommand = "up" | "down" | "status";

const COMMAND_HANDLERS: Record<MigrationCommand, (migrator: IMigrator) => Promise<void>> = {
  up: async (migrator) => {
    await migrator.up();
  },
  down: async (migrator) => {
    await migrator.down();
  },
  status: async (migrator) => {
    const [executed, pending] = await Promise.all([
      migrator.getExecutedMigrations(),
      migrator.getPendingMigrations(),
    ]);
    console.log(
      JSON.stringify({
        event: "db.migration.status",
        executed: executed.map((m) => m.name),
        pending: pending.map((m) => m.name),
      }),
    );
  },
};

function resolveCommand(rawCommand: string | undefined): (migrator: IMigrator) => Promise<void> {
  const key = (rawCommand ?? "up") as MigrationCommand;
  const handler = COMMAND_HANDLERS[key];
  if (handler === undefined) {
    throw new Error(
      `Unsupported migration command '${String(rawCommand)}'. Expected: ${Object.keys(COMMAND_HANDLERS).join(" | ")}`,
    );
  }
  return handler;
}

async function run(): Promise<void> {
  const handler = resolveCommand(process.argv[2]);
  const env = parseEnv();
  const orm = await MikroORM.init(buildMikroOrmOptions(env));

  try {
    await handler(orm.getMigrator());
  } finally {
    await orm.close(true);
  }
}

if (import.meta.main) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
