import * as D1Client from "@effect/sql-d1/D1Client"
import {
  joinKey,
  splitKey,
  type StorageAdapter,
} from "@openauthjs/openauth/storage/storage"
import { and, asc, eq, gt, isNull, lte, or, sql } from "drizzle-orm"
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"

import { Database } from "./db"
import { authDataTable, type AuthStorageValue } from "./db/schema"

const jsonValue = Schema.fromJsonString(Schema.JsonObject)

const storedRecord = Schema.Struct({ id: Schema.String, value: jsonValue })

export type RunStorageEffect = <A, E>(
  program: Effect.Effect<A, E, D1Client.D1Client | Database>,
) => Promise<A>

function getRecord(key: string[]) {
  return Effect.gen(function* () {
    const db = yield* Database
    const now = new Date(yield* Clock.currentTimeMillis)

    const rows = yield* db
      .select({ id: authDataTable.id, value: authDataTable.value })
      .from(authDataTable)
      .where(
        and(
          eq(authDataTable.id, joinKey(key)),
          or(isNull(authDataTable.expiresAt), gt(authDataTable.expiresAt, now)),
        ),
      )
      .limit(1)

    const records = yield* Schema.decodeUnknownEffect(
      Schema.Array(Schema.toType(storedRecord)),
    )(rows)

    return records[0]?.value
  })
}

function setRecord(key: string[], value: AuthStorageValue, expiry?: Date) {
  return Effect.gen(function* () {
    const db = yield* Database
    const client = yield* D1Client.D1Client
    const now = new Date(yield* Clock.currentTimeMillis)

    const encoded = yield* Schema.decodeUnknownEffect(Schema.String)(
      yield* Effect.try(() => JSON.stringify(value)),
    )

    const parsed = yield* Schema.decodeUnknownEffect(jsonValue)(encoded)

    const expiresAt = expiry
      ? yield* Schema.decodeUnknownEffect(Schema.DateFromMillis)(
          expiry.getTime(),
        )
      : null

    const cleanup = db
      .delete(authDataTable)
      .where(lte(authDataTable.expiresAt, now))
      .toSQL()

    const upsert = db
      .insert(authDataTable)
      .values({ id: joinKey(key), value: parsed, expiresAt })
      .onConflictDoUpdate({
        target: authDataTable.id,
        set: { value: parsed, expiresAt },
      })
      .toSQL()

    yield* client.batch([
      client.unsafe(cleanup.sql, cleanup.params),
      client.unsafe(upsert.sql, upsert.params),
    ])
  })
}

function removeRecord(key: string[]) {
  return Effect.gen(function* () {
    const db = yield* Database
    yield* db.delete(authDataTable).where(eq(authDataTable.id, joinKey(key)))
  })
}

function scanRecords(prefix: string[]) {
  const idPrefix = joinKey([...prefix, ""])

  return Stream.paginate(undefined, (cursor: string | undefined) =>
    Effect.gen(function* () {
      const db = yield* Database
      const now = new Date(yield* Clock.currentTimeMillis)

      const rows = yield* db
        .select({ id: authDataTable.id, value: authDataTable.value })
        .from(authDataTable)
        .where(
          and(
            sql`instr(${authDataTable.id}, ${idPrefix}) = 1`,
            cursor === undefined ? undefined : gt(authDataTable.id, cursor),
            or(
              isNull(authDataTable.expiresAt),
              gt(authDataTable.expiresAt, now),
            ),
          ),
        )
        .orderBy(asc(authDataTable.id))
        .limit(100)

      const records = yield* Schema.decodeUnknownEffect(
        Schema.Array(Schema.toType(storedRecord)),
      )(rows)

      const last = records[records.length - 1]

      return [
        records,
        records.length === 100 && last ? Option.some(last.id) : Option.none(),
      ] as const
    }),
  ).pipe(
    Stream.map((record): [string[], AuthStorageValue] => [
      splitKey(record.id),
      record.value,
    ]),
  )
}

export function D1AuthStorage(run: RunStorageEffect): StorageAdapter {
  return {
    get(key) {
      return run(getRecord(key))
    },
    set(key, value, expiry) {
      return run(setRecord(key, value, expiry))
    },
    remove(key) {
      return run(removeRecord(key))
    },
    async *scan(prefix) {
      const context = await run(Effect.context<D1Client.D1Client | Database>())

      yield* Stream.toAsyncIterableWith(context)(scanRecords(prefix))
    },
  }
}
