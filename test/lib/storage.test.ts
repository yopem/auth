import * as D1Client from "@effect/sql-d1/D1Client"
import * as Effect from "effect/Effect"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as SqlClient from "effect/sql/SqlClient"
import { Miniflare } from "miniflare"
import { readFile } from "node:fs/promises"
import { URL } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test"

import { createDatabase, Database } from "@/lib/db"
import { getUserByEmail, insertUser } from "@/lib/db/service"
import { D1AuthStorage } from "@/lib/storage"

const runtime = new Miniflare({
  modules: true,
  script: "export default { fetch() { return new Response('ok') } }",
  d1Databases: ["DB"],
})

const binding = await runtime.getD1Database("DB")

const database = ManagedRuntime.make(createDatabase(binding))

function run<A, E>(
  program: Effect.Effect<
    A,
    E,
    D1Client.D1Client | Database | SqlClient.SqlClient
  >,
) {
  return database.runPromise(program)
}

const storage = D1AuthStorage(run)

beforeAll(async () => {
  const migration = await readFile(
    new URL("./db/migrations/20261010225048_d1/migration.sql", import.meta.url),
    "utf8",
  )

  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) await binding.prepare(statement).run()
  }
})

afterAll(async () => {
  await database.dispose()
  await runtime.dispose()
})

describe("OpenAuth storage on local D1", () => {
  it("shares native D1 and SqlClient with Drizzle and maps stored JSON and dates", async () => {
    await storage.set(["shared-client"], { shared: true })
    await run(
      Effect.gen(function* () {
        const db = yield* Database
        const native = yield* D1Client.D1Client
        const sql = yield* SqlClient.SqlClient
        expect(db.$client).toBe(native)
        expect(sql).toBe(native)

        const record = yield* db.query.auth_data.findFirst({
          where: { id: "shared-client" },
        })

        expect(record?.value).toEqual({ shared: true })
      }),
    )
  })

  it("rejects invalid expiry and non-object stored JSON", async () => {
    await expect(
      storage.set(["invalid-expiry"], { valid: true }, new Date(Number.NaN)),
    ).rejects.toThrow()
    expect(await storage.get(["invalid-expiry"])).toBeUndefined()
    await binding
      .prepare("INSERT INTO auth_data (id, value) VALUES (?, ?)")
      .bind("invalid-object", "[]")
      .run()
    await expect(storage.get(["invalid-object"])).rejects.toThrow()
    await expect(
      storage.scan([])[Symbol.asyncIterator]().next(),
    ).rejects.toThrow()
    await storage.remove(["invalid-object"])
  })

  it("stores JSON, replaces records, clears expiry, and removes records", async () => {
    const key = ["roundtrip", "record"]
    await storage.set(
      key,
      { nested: { enabled: true }, list: [1, "two"] },
      new Date(Date.now() + 30_000),
    )
    expect(await storage.get(key)).toEqual({
      nested: { enabled: true },
      list: [1, "two"],
    })
    await storage.set(key, { replaced: true })
    expect(await storage.get(key)).toEqual({ replaced: true })

    const row = await binding
      .prepare("SELECT expires_at FROM auth_data WHERE id = ?")
      .bind(key.join("\u001f"))
      .first<{ expires_at: number | null }>()

    expect(row?.expires_at).toBeNull()
    await storage.remove(key)
    expect(await storage.get(key)).toBeUndefined()
    await storage.remove(key)
  })

  it("rejects expired records without extending short TTLs", async () => {
    await storage.set(
      ["expiry", "past"],
      { expired: true },
      new Date(Date.now() - 1),
    )
    await storage.set(
      ["expiry", "short"],
      { valid: true },
      new Date(Date.now() + 30_000),
    )
    expect(await storage.get(["expiry", "past"])).toBeUndefined()
    expect(await storage.get(["expiry", "short"])).toEqual({ valid: true })

    const row = await binding
      .prepare("SELECT expires_at FROM auth_data WHERE id = ?")
      .bind("expiry\u001fshort")
      .first<{ expires_at: number }>()

    expect(row?.expires_at).toBeLessThanOrEqual(Date.now() + 30_000)
  })

  it("scans exact, case-sensitive key segments and literal SQL wildcard characters", async () => {
    await storage.set(["scan%_", "one"], { value: 1 })
    await storage.set(["scan%_", "two", "nested"], { value: 2 })
    await storage.set(["scan%_other", "wrong"], { value: 3 })
    await storage.set(["SCAN%_", "wrong"], { value: 4 })
    await storage.set(["scan%_"], { value: 5 })
    await storage.set(["scan%_", "expired"], { value: 6 }, new Date(0))
    const records = []

    for await (const record of storage.scan(["scan%_"])) records.push(record)
    expect(records).toEqual([
      [["scan%_", "one"], { value: 1 }],
      [["scan%_", "two", "nested"], { value: 2 }],
    ])
  })

  it("rejects invalid stored JSON and does not read expired invalid data", async () => {
    await binding
      .prepare("INSERT INTO auth_data (id, value) VALUES (?, ?)")
      .bind("invalid-json", "not-json")
      .run()
    await expect(storage.get(["invalid-json"])).rejects.toThrow()
    await binding
      .prepare("UPDATE auth_data SET expires_at = 0 WHERE id = ?")
      .bind("invalid-json")
      .run()
    expect(await storage.get(["invalid-json"])).toBeUndefined()
  })

  it("scans more than one result page", async () => {
    for (let index = 0; index < 105; index++) {
      await storage.set(["pages", index.toString().padStart(3, "0")], { index })
    }

    const records = []

    for await (const record of storage.scan(["pages"])) records.push(record)
    expect(records).toHaveLength(105)
    expect(records[104]).toEqual([["pages", "104"], { index: 104 }])
  })
})

describe("Users and accounts on local D1", () => {
  it("creates linked account, finds user, and resolves username collisions", async () => {
    const first = await run(
      insertUser({
        email: "first@example.com",
        name: "D1 User",
        provider: "google",
        providerAccountId: "google-first",
      }),
    )

    const second = await run(
      insertUser({
        email: "second@example.com",
        name: "D1 User",
        provider: "google",
        providerAccountId: "google-second",
      }),
    )

    expect(first.username).toBe("d1user")
    expect(second.username).toBe("d1user2")
    expect(first.role).toBe("user")
    expect(first.createdAt).toBeInstanceOf(Date)
    expect(first.updatedAt).toBeInstanceOf(Date)
    expect(first.phoneNumber).toBeNull()
    expect(await run(getUserByEmail(first.email))).toEqual(first)
    expect(await run(getUserByEmail("missing@example.com"))).toBeUndefined()

    const account = await binding
      .prepare("SELECT user_id FROM accounts WHERE provider_account_id = ?")
      .bind("google-first")
      .first<{ user_id: string }>()

    expect(account?.user_id).toBe(first.id)
  })

  it("validates user rows with Effect Schema", async () => {
    await binding
      .prepare("UPDATE users SET role = ? WHERE email = ?")
      .bind("invalid-role", "first@example.com")
      .run()
    await expect(run(getUserByEmail("first@example.com"))).rejects.toThrow()
    await binding
      .prepare("UPDATE users SET role = ? WHERE email = ?")
      .bind("user", "first@example.com")
      .run()
  })

  it("rolls back user creation if account creation fails", async () => {
    await expect(
      run(
        insertUser({
          email: "rollback@example.com",
          name: "Rollback",
          provider: "google",
          providerAccountId: "google-first",
        }),
      ),
    ).rejects.toThrow()
    expect(await run(getUserByEmail("rollback@example.com"))).toBeUndefined()
  })
})
