import type * as Effect from "effect/Effect"

import * as D1Client from "@effect/sql-d1/D1Client"
import { defineRelations } from "drizzle-orm"
import * as Drizzle from "drizzle-orm/effect-d1"
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"

import { accountTable, authDataTable, userTable } from "@/lib/db/schema"

const relations = defineRelations({
  users: userTable,
  accounts: accountTable,
  auth_data: authDataTable,
})

const makeDatabase = Drizzle.makeWithDefaults({ relations })

export class Database extends Context.Service<
  Database,
  Effect.Success<typeof makeDatabase>
>()("Database") {}

export function createDatabase(binding: D1Client.D1ClientConfig["db"]) {
  const client = D1Client.layer({ db: binding })

  return Layer.effect(Database, makeDatabase).pipe(Layer.provideMerge(client))
}
