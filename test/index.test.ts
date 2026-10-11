import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Alchemy from "alchemy"
import { AlchemyContext } from "alchemy/AlchemyContext"
import { provideFreshArtifactStore } from "alchemy/Artifacts"
import * as Cloudflare from "alchemy/Cloudflare"
import * as Interaction from "alchemy/Interaction"
import * as Output from "alchemy/Output"
import * as Stack from "alchemy/Stack"
import * as State from "alchemy/State"
import * as Effect from "effect/Effect"
import { Miniflare, Response, type Request } from "miniflare"
import { readFile } from "node:fs/promises"
import { fileURLToPath, URL } from "node:url"
import { build } from "vite-plus"
import { afterAll, beforeAll, expect, it } from "vite-plus/test"

import { Constructor } from "@/index"

let runtime: Miniflare

it("resolves fresh same-plan D1 binding without saved resource state", async () => {
  const props = {
    name: "configured-root-database",
    migrations: "./src/lib/db/migrations",
  }

  const stack = Alchemy.Stack(
    "auth-plan-test",
    { providers: Cloudflare.providers(), state: State.inMemoryState() },
    Effect.gen(function* () {
      const database = yield* Cloudflare.D1.Database("database", props)
      const worker = yield* Cloudflare.Worker("auth", {}, Constructor)

      return { database, worker }
    }),
  )

  await Effect.runPromise(
    Stack.evalStack(
      stack,
      Effect.fn(function* (compiled) {
        expect(Object.keys(compiled.resources).sort()).toEqual([
          "auth",
          "database",
        ])
        expect(compiled.resources.database).toBe(compiled.output.database)
        expect(compiled.output.database.Props).toBe(props)

        const bindings = yield* Output.evaluate(compiled.bindings.auth, {
          database: { databaseId: "same-plan-database-id" },
        })

        expect(Object.keys(Output.upstreamAny(compiled.bindings.auth))).toEqual(
          ["database"],
        )

        expect(bindings).toEqual([
          {
            sid: "database",
            data: {
              bindings: [
                {
                  type: "d1",
                  name: "database",
                  databaseId: "same-plan-database-id",
                },
              ],
            },
          },
        ])
      }),
      { stage: "fresh" },
    ).pipe(
      provideFreshArtifactStore,
      Effect.provideService(AlchemyContext, {
        dotAlchemy: ".alchemy",
        dev: false,
        adopt: false,
      }),
      Effect.provide(Interaction.layerNonInteractive()),
      Effect.provide(State.inMemoryState()),
      Effect.provide(NodeServices.layer),
    ),
  )
})

beforeAll(async () => {
  const bundle = await build({
    configFile: false,
    resolve: {
      conditions: ["browser"],
      alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
    },
    define: { "globalThis.__ALCHEMY_RUNTIME__": "true" },
    plugins: [
      {
        name: "native-worker-entry",
        resolveId(id) {
          if (id.endsWith("native-worker-entry")) return "\0native-worker-entry"
        },
        load(id) {
          if (id === "\0native-worker-entry") {
            return `
            import { WorkerEntrypoint } from "cloudflare:workers"
            import { makeWorkerBridge } from "alchemy/Cloudflare/Bridge"
            import entrypoint from "@/index"
            export default makeWorkerBridge(WorkerEntrypoint, {
              entrypoint,
              stack: { name: "auth-test", stage: "test" },
            })
          `
          }
        },
      },
    ],
    build: {
      write: false,
      lib: {
        entry: "native-worker-entry",
        formats: ["es"],
      },
      rolldownOptions: {
        external: /^(node:|cloudflare:)/,
        output: { codeSplitting: false },
      },
    },
  })

  const output = Array.isArray(bundle) ? bundle[0] : bundle

  if (!("output" in output)) throw new Error("Worker build output missing")
  const chunk = output.output.find((entry) => entry.type === "chunk")

  if (chunk?.type !== "chunk") throw new Error("Worker bundle missing")
  runtime = new Miniflare({
    modules: true,
    script: chunk.code,
    scriptPath: fileURLToPath(
      new URL("./native-worker-test.js", import.meta.url),
    ),
    compatibilityDate: "2026-07-15",
    compatibilityFlags: ["nodejs_compat", "enable_nodejs_fs_module"],
    d1Databases: ["database"],
    async outboundService(request: Request) {
      const url = new URL(request.url)

      if (url.href === "https://oauth2.googleapis.com/token") {
        const body = new URLSearchParams(await request.text())
        const unverified = body.get("code") === "local-unverified-google-code"

        return Response.json({
          access_token: unverified
            ? "local-unverified-access"
            : "local-google-access",
          token_type: "Bearer",
          expires_in: 3600,
        })
      }

      if (url.href === "https://www.googleapis.com/oauth2/v3/userinfo") {
        const authorization = request.headers.get("authorization")
        const unverified = authorization === "Bearer local-unverified-access"

        expect([
          "Bearer local-google-access",
          "Bearer local-unverified-access",
        ]).toContain(authorization)

        return Response.json({
          sub: unverified ? "local-unverified-subject" : "local-google-subject",
          name: "Local User",
          picture: "https://example.com/avatar.png",
          email: unverified
            ? "unverified@example.com"
            : "local-user@example.com",
          email_verified: !unverified,
        })
      }

      throw new Error(`Unexpected outbound request: ${request.url}`)
    },
    bindings: {
      GOOGLE_CLIENT_ID: "local-test-client",
      GOOGLE_CLIENT_SECRET: "local-test-secret",
    },
  })
  const db = await runtime.getD1Database("database")

  const migration = await readFile(
    new URL(
      "../src/lib/db/migrations/20261010225048_d1/migration.sql",
      import.meta.url,
    ),
    "utf8",
  )

  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) await db.prepare(statement).run()
  }
})

afterAll(async () => {
  await runtime?.dispose()
})

it("serves discovery and persistent signing keys through actual Worker and D1", async () => {
  const discovery = await runtime.dispatchFetch(
    "https://auth.yopem.com/.well-known/oauth-authorization-server",
  )

  expect(discovery.status).toBe(200)
  expect(await discovery.json()).toMatchObject({
    issuer: "https://auth.yopem.com",
    authorization_endpoint: "https://auth.yopem.com/authorize",
    jwks_uri: "https://auth.yopem.com/.well-known/jwks.json",
  })

  const first = await runtime.dispatchFetch(
    "https://auth.yopem.com/.well-known/jwks.json",
  )

  const second = await runtime.dispatchFetch(
    "https://auth.yopem.com/.well-known/jwks.json",
  )

  expect(first.status).toBe(200)
  const keys: unknown = await first.json()
  expect(keys).toMatchObject({
    keys: expect.arrayContaining([
      expect.objectContaining({ kid: expect.any(String) }),
    ]),
  })
  expect(await second.json()).toEqual(keys)

  const concurrent = await Promise.all(
    Array.from({ length: 4 }, () =>
      runtime.dispatchFetch("https://auth.yopem.com/.well-known/jwks.json"),
    ),
  )

  for (const response of concurrent) {
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(keys)
  }

  const db = await runtime.getD1Database("database")

  const row = await db
    .prepare("SELECT count(*) AS count FROM auth_data")
    .first<{ count: number }>()

  expect(row?.count).toBeGreaterThan(0)
})

it("starts Google OAuth with Worker-bound credentials and correct callback", async () => {
  const response = await runtime.dispatchFetch(
    "https://auth.yopem.com/authorize?client_id=local-client&redirect_uri=https%3A%2F%2Fyopem.com%2Fcallback&response_type=code&provider=google&state=local-state",
    { redirect: "manual" },
  )

  expect(response.status).toBe(302)
  const location = response.headers.get("location")

  if (!location) throw new Error("OAuth redirect missing")
  const providerUrl = new URL(location, "https://auth.yopem.com")
  expect(providerUrl.pathname).toBe("/google/authorize")

  const provider = await runtime.dispatchFetch(providerUrl.href, {
    redirect: "manual",
    headers: {
      Cookie: response.headers
        .getSetCookie()
        .map((cookie) => cookie.split(";")[0])
        .join("; "),
    },
  })

  expect(provider.status).toBe(302)
  const providerLocation = provider.headers.get("location")

  if (!providerLocation) throw new Error("Google redirect missing")
  const redirect = new URL(providerLocation)
  expect(redirect.hostname).toBe("accounts.google.com")
  expect(redirect.searchParams.get("client_id")).toBe("local-test-client")
  expect(redirect.searchParams.get("redirect_uri")).toBe(
    "https://auth.yopem.com/google/callback",
  )

  const callback = new URL("https://auth.yopem.com/google/callback")
  const state = redirect.searchParams.get("state")

  if (!state) throw new Error("Google OAuth state missing")
  callback.searchParams.set("state", state)
  callback.searchParams.set("code", "local-google-code")

  const completed = await runtime.dispatchFetch(callback.href, {
    redirect: "manual",
    headers: {
      Cookie: [response, provider]
        .flatMap((entry) => entry.headers.getSetCookie())
        .map((cookie) => cookie.split(";")[0])
        .join("; "),
    },
  })

  expect(completed.status).toBe(302)

  const completedLocation = completed.headers.get("location")

  if (!completedLocation) throw new Error("Client callback missing")

  const clientCallback = new URL(completedLocation)

  expect(clientCallback.origin + clientCallback.pathname).toBe(
    "https://yopem.com/callback",
  )
  expect(clientCallback.searchParams.get("state")).toBe("local-state")
  expect(clientCallback.searchParams.get("code")).toBeTruthy()

  const db = await runtime.getD1Database("database")

  const user = await db
    .prepare("SELECT id, email FROM users WHERE email = ?")
    .bind("local-user@example.com")
    .first<{ id: string; email: string }>()

  expect(user).toMatchObject({
    id: expect.any(String),
    email: "local-user@example.com",
  })

  const account = await db
    .prepare(
      "SELECT provider, provider_account_id FROM accounts WHERE user_id = ?",
    )
    .bind(user?.id)
    .first()

  expect(account).toMatchObject({
    provider: "google",
    provider_account_id: "local-google-subject",
  })
})

it("rejects unverified Google email without creating user or account", async () => {
  const response = await runtime.dispatchFetch(
    "https://auth.yopem.com/authorize?client_id=local-client&redirect_uri=https%3A%2F%2Fyopem.com%2Fcallback&response_type=code&provider=google&state=unverified-state",
    { redirect: "manual" },
  )

  const location = response.headers.get("location")

  expect(response.status).toBe(302)

  if (!location) throw new Error("OAuth redirect missing")

  const provider = await runtime.dispatchFetch(
    new URL(location, "https://auth.yopem.com").href,
    {
      redirect: "manual",
      headers: {
        Cookie: response.headers
          .getSetCookie()
          .map((cookie) => cookie.split(";")[0])
          .join("; "),
      },
    },
  )

  const providerLocation = provider.headers.get("location")

  expect(provider.status).toBe(302)

  if (!providerLocation) throw new Error("Google redirect missing")

  const state = new URL(providerLocation).searchParams.get("state")

  if (!state) throw new Error("Google OAuth state missing")

  const callback = new URL("https://auth.yopem.com/google/callback")

  callback.searchParams.set("state", state)
  callback.searchParams.set("code", "local-unverified-google-code")

  const rejected = await runtime.dispatchFetch(callback.href, {
    redirect: "manual",
    headers: {
      Cookie: [response, provider]
        .flatMap((entry) => entry.headers.getSetCookie())
        .map((cookie) => cookie.split(";")[0])
        .join("; "),
    },
  })

  expect(rejected.status).toBe(302)

  const rejectedLocation = rejected.headers.get("location")

  if (!rejectedLocation) throw new Error("OAuth error callback missing")

  const errorCallback = new URL(rejectedLocation)

  expect(errorCallback.origin + errorCallback.pathname).toBe(
    "https://yopem.com/callback",
  )
  expect(errorCallback.searchParams.get("error")).toBe("server_error")
  expect(errorCallback.searchParams.get("code")).toBeNull()

  const db = await runtime.getD1Database("database")

  const user = await db
    .prepare("SELECT id FROM users WHERE email = ?")
    .bind("unverified@example.com")
    .first()

  const account = await db
    .prepare("SELECT user_id FROM accounts WHERE provider_account_id = ?")
    .bind("local-unverified-subject")
    .first()

  expect(user).toBeNull()
  expect(account).toBeNull()
})
