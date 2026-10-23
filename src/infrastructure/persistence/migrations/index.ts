import { Migration0001InitialSchema } from "@infrastructure/persistence/migrations/Migration0001InitialSchema";
import { MigrationObject } from "@mikro-orm/core";

export const MIGRATIONS_LIST: MigrationObject[] = [
  {
    name: "Migration0001InitialSchema",
    class: Migration0001InitialSchema,
  },
];
