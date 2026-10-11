import * as D1 from "@distilled.cloud/cloudflare/d1"
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import * as Alchemy from "alchemy"
import { adopt } from "alchemy/AdoptPolicy"
import * as Cloudflare from "alchemy/Cloudflare"
import { retain } from "alchemy/RemovalPolicy"
import * as State from "alchemy/State"
import * as Config from "effect/Config"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"

import { Constructor } from "./src/index"

const configSchema = Schema.Struct({
  APP_NAME: Schema.NonEmptyString,
  WORKER_NAME: Schema.NonEmptyString,
  WORKER_DOMAIN: Schema.String.check(
    Schema.isPattern(
      /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i,
    ),
  ),
  DATABASE_NAME: Schema.NonEmptyString,
  DATABASE_ID: Schema.String.check(Schema.isUUID()),
  PORT: Schema.NumberFromString.check(
    Schema.isInt(),
    Schema.isBetween({ minimum: 1, maximum: 65535 }),
  ),
  OBSERVABILITY_ENABLED: Schema.Literals(["true", "false"]),
  COMPATIBILITY_DATE: Schema.String.check(
    Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/),
    Schema.makeFilter((value) => {
      const date = new Date(value)

      return (
        !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === value
      )
    }),
  ),
  COMPATIBILITY_FLAGS: Schema.NonEmptyString.check(
    Schema.makeFilter((flags) =>
      flags.split(",").every((flag) => flag.trim().length > 0),
    ),
  ),
  GOOGLE_CLIENT_ID: Schema.NonEmptyString,
  GOOGLE_CLIENT_SECRET: Schema.NonEmptyString,
})

const config = await Effect.runPromise(
  Effect.all(
    Object.fromEntries(
      Object.keys(configSchema.fields).map((key) => [key, Config.String(key)]),
    ),
  ).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(configSchema)),
    Effect.provide(
      ConfigProvider.layerAdd(
        ConfigProvider.fromDotEnv({ path: ".env", preserveEmptyStrings: true }),
        { asPrimary: false },
      ),
    ),
    Effect.provide(NodeFileSystem.layer),
  ),
)

export const database = Effect.gen(function* () {
  const local = yield* Alchemy.ALCHEMY_DEV
  const stack = yield* Alchemy.Stack
  let existing: D1.GetDatabaseResponse | undefined

  if (!local) {
    if (stack.stage !== "prod") {
      return yield* Effect.die(
        new Error("Use the prod stage for live resources"),
      )
    }

    const stateEffect = Option.getOrUndefined(
      yield* Effect.serviceOption(State.State),
    )

    if (stateEffect === undefined) {
      return yield* Effect.die(new Error("Alchemy state service is required"))
    }

    const state = yield* stateEffect

    const previous = yield* state.get({
      stack: stack.name,
      stage: stack.stage,
      fqn: "database",
    })

    if (
      previous &&
      (!("resourceType" in previous) ||
        previous.resourceType !== "Cloudflare.D1Database" ||
        !previous.attr)
    ) {
      return yield* Effect.die(
        new Error("D1 state has no valid saved resource identity"),
      )
    }

    if (
      previous &&
      "status" in previous &&
      (previous.status === "replacing" ||
        previous.status === "replaced" ||
        previous.status === "deleting")
    ) {
      return yield* Effect.die(
        new Error("D1 state requires review before deployment"),
      )
    }

    if (
      previous &&
      "attr" in previous &&
      previous.attr &&
      previous.attr.databaseId !== config.DATABASE_ID
    ) {
      return yield* Effect.die(
        new Error("Alchemy state points to a different D1 database"),
      )
    }

    if (
      previous &&
      "providerMode" in previous &&
      previous.providerMode === "local"
    ) {
      return yield* Effect.die(
        new Error("Local D1 state cannot be used for live resources"),
      )
    }

    const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment
    existing = yield* D1.getDatabase({
      accountId,
      databaseId: config.DATABASE_ID,
    })

    if (
      existing.uuid !== config.DATABASE_ID ||
      existing.name !== config.DATABASE_NAME
    ) {
      return yield* Effect.die(
        new Error("D1 database ID and name must match .env"),
      )
    }

    if (
      previous &&
      "attr" in previous &&
      previous.attr &&
      (previous.attr.accountId !== accountId ||
        previous.attr.databaseName !== config.DATABASE_NAME ||
        (previous.attr.jurisdiction ?? "default") !==
          (existing.jurisdiction ?? "default"))
    ) {
      return yield* Effect.die(
        new Error("Alchemy state would replace the configured D1 database"),
      )
    }
  }

  const jurisdiction = yield* Schema.decodeUnknownEffect(
    Schema.Literals(["default", "eu", "fedramp"]),
  )(existing?.jurisdiction ?? "default")

  const replication = yield* Schema.decodeUnknownEffect(
    Schema.Literals(["auto", "disabled"]),
  )(existing?.readReplication?.mode ?? "disabled")

  return yield* Cloudflare.D1.Database("database", {
    name: config.DATABASE_NAME,
    jurisdiction,
    readReplication: { mode: replication },
    migrations: "./src/lib/db/migrations",
  }).pipe(retain())
}).pipe(Effect.orDie)

export const worker = Cloudflare.Worker(
  "auth",
  {
    name: config.WORKER_NAME,
    main: "./src/index.ts",
    compatibility: {
      date: config.COMPATIBILITY_DATE,
      flags: config.COMPATIBILITY_FLAGS.split(",").map((flag) => flag.trim()),
    },
    observability: { enabled: config.OBSERVABILITY_ENABLED === "true" },
    env: {
      GOOGLE_CLIENT_ID: config.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: Redacted.make(config.GOOGLE_CLIENT_SECRET),
    },
    domain: config.WORKER_DOMAIN,
    dev: { port: config.PORT, strictPort: true },
  },
  Constructor,
).pipe(adopt(true), retain())

export default Alchemy.Stack(
  config.APP_NAME,
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    yield* database
    const deployed = yield* worker

    return { url: deployed.url }
  }),
)
