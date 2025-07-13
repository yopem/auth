import { type ExecutionContext } from "@cloudflare/workers-types"
import { issuer } from "@openauthjs/openauth"
import { GoogleProvider } from "@openauthjs/openauth/provider/google"
import { CloudflareStorage } from "@openauthjs/openauth/storage/cloudflare"

import { getUserByEmail, insertUser } from "@/lib/db/service"
import { subjects } from "./subjects"

export default {
  async fetch(
    request: Request,
    env: CloudflareBindings,
    ctx: ExecutionContext,
  ) {
    return issuer({
      storage: CloudflareStorage({
        namespace: env["yopem-auth"],
      }),
      subjects,
      ttl: {
        access: 60 * 60 * 24 * 30,
        refresh: 60 * 60 * 24 * 365,
        reuse: 61,
      },
      providers: {
        google: GoogleProvider({
          clientID: process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
          scopes: ["email", "profile"],
        }),
      },
      async success(ctx, value) {
        const access = value.tokenset.access

        interface GoogleUserInfo {
          sub: string
          name: string
          given_name: string
          picture: string
          email: string
          email_verified: boolean
        }

        const response = await fetch(
          "https://www.googleapis.com/oauth2/v3/userinfo",
          {
            headers: {
              Authorization: `Bearer ${access}`,
              Accept: "application/json",
            },
          },
        )

        if (!response.ok) {
          throw new Error(
            `Failed to fetch user info from Google: ${response.statusText}`,
          )
        }

        const { sub, name, picture, email }: GoogleUserInfo =
          await response.json()

        const existingUser = await getUserByEmail(email)

        if (!existingUser) {
          const user = await insertUser({
            email: email,
            name: name,
            image: picture,
            provider: "google",
            providerAccountId: sub,
          })

          return ctx.subject("user", {
            id: user.id,
            email: user.email,
            name: user.name,
            username: user.username,
            image: user.image,
            role: user.role,
          })
        }

        return ctx.subject("user", {
          id: existingUser.id,
          email: existingUser.email,
          name: existingUser.name,
          username: existingUser.username,
          image: existingUser.image,
          role: existingUser.role,
        })
      },
    }).fetch(request, env, ctx)
  },
}
