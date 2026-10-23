import { AppEnv } from "@infrastructure/config/env";
import { MIGRATIONS_LIST } from "@infrastructure/persistence/migrations";
import { PERSISTENCE_SCHEMAS } from "@infrastructure/persistence/schemas";
import { Migrator } from "@mikro-orm/migrations";
import { PostgreSqlDriver, defineConfig } from "@mikro-orm/postgresql";

export function buildMikroOrmOptions(env: AppEnv) {
  return defineConfig({
    driver: PostgreSqlDriver,
    clientUrl: env.DATABASE_URL,
    entities: PERSISTENCE_SCHEMAS,
    discovery: {
      warnWhenNoEntities: false,
    },
    allowGlobalContext: true,
    pool: {
      min: env.DB_POOL_MIN,
      max: env.DB_POOL_MAX,
    },
    extensions: [Migrator],
    migrations: {
      tableName: "mikro_orm_migrations",
      transactional: true,
      allOrNothing: true,
      migrationsList: MIGRATIONS_LIST,
    },
    debug: false,
  });
}
