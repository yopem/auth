import {
  joinKey,
  splitKey,
  type StorageAdapter,
} from "@openauthjs/openauth/storage/storage"
import { and, eq, gt, isNull, like, or } from "drizzle-orm"

import { db } from "./db"
import { authDataTable, authDataValue } from "./db/schema"

type AuthDataInput = Record<
  string,
  (typeof authDataTable.$inferInsert)["value"][string] | undefined
>

export function DrizzleAuthStorage(): StorageAdapter {
  return {
    async get(key: string[]) {
      const id = joinKey(key)

      const entry = await db.query.authDataTable.findFirst({
        where: eq(authDataTable.id, id),
      })

      if (!entry) return undefined

      if (entry.expiry && Date.now() >= entry.expiry.getTime()) {
        await db.delete(authDataTable).where(eq(authDataTable.id, id))

        return undefined
      }

      return entry.value
    },

    async set(key: string[], value: AuthDataInput, expiry?: Date) {
      const id = joinKey(key)

      const serialized = JSON.stringify(value)

      const json: unknown =
        serialized === undefined ? undefined : JSON.parse(serialized)

      const data = authDataValue.parse(json)

      await db
        .insert(authDataTable)
        .values({
          id,
          value: data,
          expiry,
        })
        .onConflictDoUpdate({
          target: authDataTable.id,
          set: {
            value: data,
            expiry: expiry ?? null,
          },
        })
    },

    async remove(key: string[]) {
      const id = joinKey(key)
      await db.delete(authDataTable).where(eq(authDataTable.id, id))
    },

    async *scan(prefix: string[]) {
      const now = new Date()
      const idPrefix = joinKey(prefix)

      const entries = await db.query.authDataTable.findMany({
        where: and(
          like(authDataTable.id, `${idPrefix}%`),
          or(isNull(authDataTable.expiry), gt(authDataTable.expiry, now)),
        ),
      })

      for (const entry of entries) {
        yield [splitKey(entry.id), entry.value]
      }
    },
  }
}
