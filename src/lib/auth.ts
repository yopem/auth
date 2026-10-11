import type * as D1Client from "@effect/sql-d1/D1Client"
import type * as Context from "effect/Context"
import type * as Scope from "effect/Scope"

import { issuer } from "@openauthjs/openauth"
import { GoogleProvider } from "@openauthjs/openauth/provider/google"
import { RuntimeContext } from "alchemy/RuntimeContext"
import * as Effect from "effect/Effect"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import { AsyncLocalStorage } from "node:async_hooks"

import type { Database } from "@/lib/db"

import { getUserByEmail, insertUser } from "@/lib/db/service"
import { D1AuthStorage } from "@/lib/storage"
import { subjects } from "@/subjects"

type AuthServices =
  | Database
  | D1Client.D1Client
  | HttpClient.HttpClient
  | Scope.Scope
  | RuntimeContext

const requestContext = new AsyncLocalStorage<Context.Context<AuthServices>>()

const googleUserInfo = Schema.Struct({
  sub: Schema.NonEmptyString,
  name: Schema.String,
  picture: Schema.String,
  email: Schema.String.check(
    Schema.isPattern(
      /^(?:[A-Za-z0-9_'+-]+\.)*[A-Za-z0-9_'+-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/,
    ),
  ),
  email_verified: Schema.Literal(true),
})

function runAuth<A, E>(program: Effect.Effect<A, E, AuthServices>): Promise<A> {
  const context = requestContext.getStore()

  if (!context) {
    return Promise.reject(
      new Error("Auth operation requires a request context"),
    )
  }

  return Effect.runPromise(program.pipe(Effect.provideContext(context)))
}

export function createAuth() {
  return Effect.gen(function* () {
    const runtime = yield* RuntimeContext

    const clientID = yield* Schema.decodeUnknownEffect(Schema.NonEmptyString)(
      yield* runtime.get("GOOGLE_CLIENT_ID"),
    )

    const secret = yield* runtime.get<unknown>("GOOGLE_CLIENT_SECRET")

    const clientSecret = yield* Schema.decodeUnknownEffect(
      Schema.NonEmptyString,
    )(Redacted.isRedacted(secret) ? Redacted.value(secret) : secret)

    return issuer({
      storage: D1AuthStorage(runAuth),
      subjects,
      ttl: {
        access: 60 * 60 * 24 * 30,
        refresh: 60 * 60 * 24 * 365,
        reuse: 61,
      },
      providers: {
        google: GoogleProvider({
          clientID,
          clientSecret,
          scopes: ["openid", "email", "profile"],
        }),
      },
      success(ctx, value) {
        return runAuth(
          Effect.gen(function* () {
            const response = yield* HttpClient.get(
              "https://www.googleapis.com/oauth2/v3/userinfo",
              {
                headers: {
                  Authorization: `Bearer ${value.tokenset.access}`,
                  Accept: "application/json",
                },
              },
            )

            yield* HttpClientResponse.filterStatusOk(response)

            const { sub, name, picture, email } =
              yield* HttpClientResponse.schemaBodyJson(googleUserInfo)(response)

            const existingUser = yield* getUserByEmail(email)

            const user =
              existingUser ??
              (yield* insertUser({
                email,
                name,
                image: picture,
                provider: "google",
                providerAccountId: sub,
              }))

            return yield* Effect.promise(() =>
              ctx.subject("user", {
                id: user.id,
                email: user.email,
                name: user.name,
                username: user.username,
                image: user.image,
                role: user.role,
              }),
            )
          }),
        )
      },
    })
  })
}

export function handleAuth(
  auth: ReturnType<typeof createAuth>,
  request: Request,
) {
  return Effect.gen(function* () {
    const context = yield* Effect.context<AuthServices>()

    return yield* Effect.promise(() =>
      requestContext.run(context, () =>
        runAuth(
          Effect.gen(function* () {
            const app = yield* auth

            return yield* Effect.promise(() =>
              Promise.resolve(app.fetch(request)),
            )
          }),
        ),
      ),
    )
  })
}
