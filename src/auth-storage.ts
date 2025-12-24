import {
  joinKey,
  splitKey,
  type StorageAdapter,
} from "@openauthjs/openauth/storage/storage"
import { and, eq, gt, isNull, like, or } from "drizzle-orm"

import { db } from "./lib/db"
import { authDataTable } from "./lib/db/schema"

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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async set(key: string[], value: Record<string, any>, expiry?: Date) {
      const id = joinKey(key)

      await db
        .insert(authDataTable)
        .values({
          id,
          value,
          expiry,
        })
        .onConflictDoUpdate({
          target: authDataTable.id,
          set: {
            value,
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
