import * as Cloudflare from "alchemy/Cloudflare"
import * as Effect from "effect/Effect"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import * as Layer from "effect/Layer"

import { createAuth, handleAuth } from "@/lib/auth"
import { createDatabase } from "@/lib/db"

export const Constructor = Effect.gen(function* () {
  const connection = yield* Cloudflare.D1.QueryDatabase(
    Cloudflare.D1.Database("database"),
  )

  const auth = yield* Effect.cached(createAuth())

  return {
    fetch: Effect.gen(function* () {
      const request = yield* Cloudflare.Request
      const response = yield* handleAuth(auth, request)

      return HttpServerResponse.fromWeb(response)
    }).pipe(
      Effect.provide(Layer.unwrap(Effect.map(connection.raw, createDatabase))),
      Effect.provide(FetchHttpClient.layer),
      Effect.orDie,
    ),
  }
}).pipe(Effect.provide(Cloudflare.D1.QueryDatabaseBinding))

export default Cloudflare.Worker("auth", {}, Constructor)
