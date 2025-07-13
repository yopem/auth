import { eq } from "drizzle-orm"

import { db } from "@/lib/db"
import { slugifyUsername } from "@/lib/utils"
import { accountTable, userTable, type InsertUser } from "./schema"

interface InsertUserProps extends Omit<InsertUser, "username"> {
  provider: string
  providerAccountId: string
}

export const insertUser = async ({
  email,
  name,
  image,
  provider,
  providerAccountId,
}: InsertUserProps) => {
  const user = await db
    .insert(userTable)
    .values({
      email: email,
      name: name,
      username: await generateUniqueUsername(name!),
      image: image,
    })
    .returning()

  await db.insert(accountTable).values({
    provider,
    providerAccountId,
    userId: user[0].id,
  })

  return user[0]
}

export const getUserByEmail = async (userEmail: string) => {
  return await db.query.userTable.findFirst({
    where: eq(userTable.email, userEmail),
  })
}

export const generateUniqueUsername = async (name: string): Promise<string> => {
  const username = slugifyUsername(name)
  let uniqueUsername = username
  let suffix = 1

  while (
    await db.query.userTable.findFirst({
      where: (user, { eq }) => eq(user.username, uniqueUsername),
    })
  ) {
    suffix++
    uniqueUsername = `${username}${suffix}`
  }

  return uniqueUsername
}
