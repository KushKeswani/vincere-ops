import { createDatabaseClient } from "../src/lib/db/client";
import { migrateDatabase } from "../src/lib/db/migrate";

const database = createDatabaseClient();

try {
  await migrateDatabase(database);
  console.log("Database migrations applied.");
} finally {
  await database.close();
}
