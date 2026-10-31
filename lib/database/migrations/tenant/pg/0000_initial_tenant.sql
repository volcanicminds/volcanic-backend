CREATE TABLE "change_log" (
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
CREATE TABLE "governance_log" (
	"id" text PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"action" text NOT NULL,
	"outcome" text NOT NULL,
	"intent_id" text,
	"actor_id" text,
	"actor_kind" text,
	"tenant_id" text,
	"target_id" text,
	"detail" jsonb,
	"request_id" text,
	"ip" text
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
	"pairing_code_hash" text,
	"pairing_code_expires_at" timestamp with time zone,
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
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_founder" boolean DEFAULT false NOT NULL,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"mfa_secret" text,
	"mfa_type" text,
	"mfa_last_used_counter" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "change_log_entity_idx" ON "change_log" USING btree ("entity_name","entity_id");--> statement-breakpoint
CREATE INDEX "change_log_created_at_idx" ON "change_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "governance_log_occurred_idx" ON "governance_log" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "governance_log_tenant_idx" ON "governance_log" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "governance_log_actor_idx" ON "governance_log" USING btree ("actor_id","occurred_at");--> statement-breakpoint
CREATE INDEX "governance_log_action_idx" ON "governance_log" USING btree ("action","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "migration_set_name_uq" ON "migration" USING btree ("set","name");--> statement-breakpoint
CREATE UNIQUE INDEX "token_external_id_uq" ON "token" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "token_deleted_at_idx" ON "token" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_uq" ON "user" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "user_external_id_uq" ON "user" USING btree ("external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_username_uq" ON "user" USING btree ("username") WHERE "user"."username" is not null;--> statement-breakpoint
CREATE INDEX "user_reset_token_idx" ON "user" USING btree ("reset_password_token");--> statement-breakpoint
CREATE INDEX "user_confirmation_token_idx" ON "user" USING btree ("confirmation_token");--> statement-breakpoint
CREATE INDEX "user_deleted_at_idx" ON "user" USING btree ("deleted_at");--> statement-breakpoint
-- Written by hand, drizzle-kit does not generate it: the database refuses to rewrite the
-- governance log. The control set has the same block; scripts/check-migration-sets.mjs
-- refuses a set that creates the table without it.
CREATE FUNCTION "governance_log_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'governance_log is append-only: % refused', TG_OP;
END
$$;--> statement-breakpoint
CREATE TRIGGER "governance_log_append_only" BEFORE UPDATE OR DELETE OR TRUNCATE ON "governance_log" FOR EACH STATEMENT EXECUTE FUNCTION "governance_log_append_only"();--> statement-breakpoint
ALTER TABLE "governance_log" ENABLE ALWAYS TRIGGER "governance_log_append_only";