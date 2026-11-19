import { z } from "zod"

// Only this adapter reads environment variables.
// oxlint-disable-next-line quality/no-environment-access
const { DATABASE_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env

export const databaseUrl = z.string().min(1).optional().parse(DATABASE_URL)

const googleCredentials = z.object({
  clientID: z.string().min(1),
  clientSecret: z.string().min(1),
})

export function getGoogleCredentials() {
  return googleCredentials.parse({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
  })
}
