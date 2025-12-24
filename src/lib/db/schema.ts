import { jsonb, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { z } from "zod"

import { createCustomId } from "@/lib/utils"

export const USER_ROLE = ["user", "member", "admin"] as const

export const userRole = z.enum(USER_ROLE)

export const userRoleEnum = pgEnum("user_role", USER_ROLE)

export const userTable = pgTable("users", {
  id: text()
    .primaryKey()
    .$defaultFn(() => createCustomId()),
  email: text("email").notNull().unique(),
  name: text("name"),
  username: text("username").notNull().unique(),
  image: text("image"),
  phoneNumber: text("phone_number"),
  about: text("about"),
  role: userRoleEnum("role").notNull().default("user"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
})

export const accountTable = pgTable("accounts", {
  provider: text("provider").notNull(),
  providerAccountId: text("provider_account_id")
    .notNull()
    .unique()
    .primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => userTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
})

export const sessionTable = pgTable("sessions", {
  key: text("key").notNull().primaryKey(),
  value: text("value").notNull(),
})

export const authDataTable = pgTable("auth_data", {
  id: text().primaryKey(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: jsonb().$type<Record<string, any>>().notNull(),
  expiry: timestamp(),
})

export type InsertUser = typeof userTable.$inferInsert
