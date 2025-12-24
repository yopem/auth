import { drizzle } from "drizzle-orm/node-postgres"

import { databaseUrl } from "@/lib/env"
import { accountTable, authDataTable, sessionTable, userTable } from "./schema"

export const db = drizzle(databaseUrl, {
  schema: {
    accountTable,
    sessionTable,
    userTable,
    authDataTable,
  },
})
