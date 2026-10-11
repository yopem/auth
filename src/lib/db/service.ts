import * as D1Client from "@effect/sql-d1/D1Client"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { createCustomId, slugifyUsername } from "@/lib/utils"

import { Database } from "./index"
import { accountTable, userRecord, userTable, type InsertUser } from "./schema"

interface InsertUserProps extends Omit<InsertUser, "username"> {
  provider: string
  providerAccountId: string
}

export function insertUser({
  email,
  name,
  image,
  provider,
  providerAccountId,
}: InsertUserProps) {
  return Effect.gen(function* () {
    const db = yield* Database
    const client = yield* D1Client.D1Client
    const id = yield* Effect.sync(createCustomId)
    const username = yield* generateUniqueUsername(name ?? email.split("@")[0])

    const insert = db
      .insert(userTable)
      .values({ id, email, name, username, image })
      .toSQL()

    const account = db
      .insert(accountTable)
      .values({ provider, providerAccountId, userId: id })
      .toSQL()

    yield* client.batch([
      client.unsafe(insert.sql, insert.params),
      client.unsafe(account.sql, account.params),
    ])

    const user = yield* getUserByEmail(email)

    if (!user) return yield* Effect.fail(new Error("Failed to create user"))

    return user
  })
}

export function getUserByEmail(userEmail: string) {
  return Effect.gen(function* () {
    const db = yield* Database

    const user = yield* db.query.users.findFirst({
      where: { email: userEmail },
    })

    if (!user) return undefined

    return yield* Schema.decodeUnknownEffect(Schema.toType(userRecord))(user)
  })
}

export function generateUniqueUsername(name: string) {
  return Effect.gen(function* () {
    const db = yield* Database
    const username = slugifyUsername(name) || "user"
    let uniqueUsername = username
    let suffix = 1

    while (
      yield* db.query.users.findFirst({
        columns: { id: true },
        where: { username: uniqueUsername },
      })
    ) {
      suffix++
      uniqueUsername = `${username}${suffix}`
    }

    return uniqueUsername
  })
}
