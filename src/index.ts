import { issuer } from "@openauthjs/openauth"
import { GoogleProvider } from "@openauthjs/openauth/provider/google"
import { z } from "zod"

import { getUserByEmail, insertUser } from "@/lib/db/service"
import { getGoogleCredentials } from "@/lib/env"
import { DrizzleAuthStorage } from "@/lib/storage"

import { subjects } from "./subjects"

const googleUserInfo = z.object({
  sub: z.string().min(1),
  name: z.string(),
  picture: z.string().nullish(),
  email: z.string().min(1),
})

export default issuer({
  storage: DrizzleAuthStorage(),
  subjects,
  ttl: {
    access: 60 * 60 * 24 * 30,
    refresh: 60 * 60 * 24 * 365,
    reuse: 61,
  },
  providers: {
    google: GoogleProvider({
      ...getGoogleCredentials(),
      scopes: ["openid", "email", "profile"],
    }),
  },
  async success(ctx, value) {
    const access = value.tokenset.access

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

    const result = googleUserInfo.safeParse(await response.json())

    if (!result.success) {
      throw new Error("Invalid user information from Google")
    }

    const { sub, name, picture, email } = result.data

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
})
