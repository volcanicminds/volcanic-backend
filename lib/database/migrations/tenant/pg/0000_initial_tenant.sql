CREATE TABLE "change" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text,
	"token_id" text,
	"impersonation_id" text,
	"status" text NOT NULL,
	"entity_name" text NOT NULL,
	"entity_id" text NOT NULL,
	"contents" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "migration" (
	"id" text PRIMARY KEY NOT NULL,
	"set" text NOT NULL,
	"name" text NOT NULL,
	"hash" text NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "token" (
	"id" text PRIMARY KEY NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"blocked" boolean DEFAULT false NOT NULL,
	"blocked_reason" text,
	"blocked_at" timestamp with time zone,
	"roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"expires_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"external_id" text NOT NULL,
	"username" text,
	"email" text NOT NULL,
	"password" text NOT NULL,
	"confirmed" boolean DEFAULT false NOT NULL,
	"confirmed_at" timestamp with time zone,
	"password_changed_at" timestamp with time zone,
	"blocked" boolean DEFAULT false NOT NULL,
	"blocked_reason" text,
	"blocked_at" timestamp with time zone,
	"reset_password_token" text,
	"reset_password_token_at" timestamp with time zone,
	"confirmation_token" text,
	"roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_founder" boolean DEFAULT false NOT NULL,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"mfa_secret" text,
	"mfa_type" text,
	"mfa_recovery_codes" text[],
	"mfa_last_used_counter" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "change_entity_idx" ON "change" USING btree ("entity_name","entity_id");--> statement-breakpoint
CREATE INDEX "change_created_at_idx" ON "change" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "migration_set_name_uq" ON "migration" USING btree ("set","name");--> statement-breakpoint
CREATE UNIQUE INDEX "token_external_id_uq" ON "token" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "token_deleted_at_idx" ON "token" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_uq" ON "user" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "user_external_id_uq" ON "user" USING btree ("external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_username_uq" ON "user" USING btree ("username") WHERE "user"."username" is not null;--> statement-breakpoint
CREATE INDEX "user_reset_token_idx" ON "user" USING btree ("reset_password_token");--> statement-breakpoint
CREATE INDEX "user_confirmation_token_idx" ON "user" USING btree ("confirmation_token");--> statement-breakpoint
CREATE INDEX "user_deleted_at_idx" ON "user" USING btree ("deleted_at");