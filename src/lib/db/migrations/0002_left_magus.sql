CREATE TABLE "auth_data" (
	"id" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"expiry" timestamp
);
