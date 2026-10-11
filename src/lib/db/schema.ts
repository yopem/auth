import type { StorageAdapter } from "@openauthjs/openauth/storage/storage"

import { sql } from "drizzle-orm"
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import * as Schema from "effect/Schema"

import { createCustomId } from "@/lib/utils"

export const USER_ROLE = ["user", "member", "admin"] as const

export const userRole = Schema.Literals(USER_ROLE)

export const userRecord = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  name: Schema.NullOr(Schema.String),
  username: Schema.String,
  image: Schema.NullOr(Schema.String),
  phoneNumber: Schema.NullOr(Schema.String),
  about: Schema.NullOr(Schema.String),
  role: userRole,
  createdAt: Schema.NullOr(Schema.DateFromMillis),
  updatedAt: Schema.NullOr(Schema.DateFromMillis),
})

export const userTable = sqliteTable("users", {
  id: text()
    .primaryKey()
    .$defaultFn(() => createCustomId()),
  email: text("email").notNull().unique(),
  name: text("name"),
  username: text("username").notNull().unique(),
  image: text("image"),
  phoneNumber: text("phone_number"),
  about: text("about"),
  role: text("role", { enum: USER_ROLE }).notNull().default("user"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(
    sql`(unixepoch() * 1000)`,
  ),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(
    sql`(unixepoch() * 1000)`,
  ),
})

export const accountTable = sqliteTable("accounts", {
  provider: text("provider").notNull(),
  providerAccountId: text("provider_account_id").notNull().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => userTable.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(
    sql`(unixepoch() * 1000)`,
  ),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(
    sql`(unixepoch() * 1000)`,
  ),
})

export type AuthStorageValue = Parameters<StorageAdapter["set"]>[1]

export const authDataTable = sqliteTable(
  "auth_data",
  {
    id: text("id").primaryKey(),
    value: text("value", { mode: "json" }).$type<AuthStorageValue>().notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("auth_data_expires_at_idx").on(table.expiresAt)],
)

export type InsertUser = typeof userTable.$inferInsert
