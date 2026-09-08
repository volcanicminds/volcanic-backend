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
CREATE TABLE "destruction_request" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"system_user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"preview" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"export_ref" text
);
--> statement-breakpoint
CREATE TABLE "impersonation" (
	"id" text PRIMARY KEY NOT NULL,
	"system_user_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"target_user_id" text NOT NULL,
	"reason" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
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
CREATE TABLE "system_user" (
	"id" text PRIMARY KEY NOT NULL,
	"external_id" text NOT NULL,
	"email" text NOT NULL,
	"password" text NOT NULL,
	"blocked" boolean DEFAULT false NOT NULL,
	"blocked_reason" text,
	"blocked_at" timestamp with time zone,
	"roles" text[] DEFAULT '{}'::text[] NOT NULL,
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
CREATE TABLE "tenant" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"strategy" text NOT NULL,
	"engine" text NOT NULL,
	"locator" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"schema_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
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
CREATE INDEX "destruction_tenant_idx" ON "destruction_request" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "destruction_expires_idx" ON "destruction_request" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "impersonation_tenant_idx" ON "impersonation" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "impersonation_actor_idx" ON "impersonation" USING btree ("system_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "migration_set_name_uq" ON "migration" USING btree ("set","name");--> statement-breakpoint
CREATE UNIQUE INDEX "system_user_email_uq" ON "system_user" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "system_user_external_id_uq" ON "system_user" USING btree ("external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_slug_uq" ON "tenant" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_locator_uq" ON "tenant" USING btree ("engine","locator");--> statement-breakpoint
CREATE INDEX "tenant_status_idx" ON "tenant" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "token_external_id_uq" ON "token" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "token_deleted_at_idx" ON "token" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_uq" ON "user" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "user_external_id_uq" ON "user" USING btree ("external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_username_uq" ON "user" USING btree ("username") WHERE "user"."username" is not null;--> statement-breakpoint
CREATE INDEX "user_reset_token_idx" ON "user" USING btree ("reset_password_token");--> statement-breakpoint
CREATE INDEX "user_confirmation_token_idx" ON "user" USING btree ("confirmation_token");--> statement-breakpoint
CREATE INDEX "user_deleted_at_idx" ON "user" USING btree ("deleted_at");