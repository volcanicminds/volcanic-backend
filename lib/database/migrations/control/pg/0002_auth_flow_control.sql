CREATE TABLE "access_log" (
	"id" text PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scope" text DEFAULT 'tenant' NOT NULL,
	"event" text NOT NULL,
	"outcome" text NOT NULL,
	"code" text,
	"subject_id" text,
	"methods" text[],
	"provider" text,
	"flow_id" text,
	"sid" text,
	"ip" text
);
--> statement-breakpoint
CREATE TABLE "auth_flow" (
	"id" text PRIMARY KEY NOT NULL,
	"flow_id" text NOT NULL,
	"scope" text DEFAULT 'tenant' NOT NULL,
	"subject_id" text,
	"candidate_subject_id" text,
	"secret_hash" text NOT NULL,
	"flow_name" text,
	"stage_index" integer DEFAULT 0 NOT NULL,
	"satisfied" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"challenge_method" text,
	"challenge_hash" text,
	"challenge_expires_at" timestamp with time zone,
	"challenge_attempts" integer DEFAULT 0 NOT NULL,
	"challenge_sends" integer DEFAULT 0 NOT NULL,
	"last_sent_at" timestamp with time zone,
	"state_hash" text,
	"external" text,
	"external_result" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_identity" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text DEFAULT 'tenant' NOT NULL,
	"subject_id" text NOT NULL,
	"provider" text NOT NULL,
	"issuer" text NOT NULL,
	"subject" text NOT NULL,
	"email_at_link" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "identity_provider" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"key" text NOT NULL,
	"type" text DEFAULT 'oidc' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret_enc" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "auth_methods" text[];--> statement-breakpoint
CREATE INDEX "access_log_occurred_idx" ON "access_log" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "access_log_subject_idx" ON "access_log" USING btree ("subject_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_flow_flow_id_uq" ON "auth_flow" USING btree ("flow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_flow_subject_uq" ON "auth_flow" USING btree ("subject_id","scope") WHERE "auth_flow"."subject_id" is not null;--> statement-breakpoint
CREATE INDEX "auth_flow_state_idx" ON "auth_flow" USING btree ("state_hash");--> statement-breakpoint
CREATE INDEX "auth_flow_candidate_idx" ON "auth_flow" USING btree ("candidate_subject_id","last_sent_at");--> statement-breakpoint
CREATE INDEX "auth_flow_expires_idx" ON "auth_flow" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "external_identity_key_uq" ON "external_identity" USING btree ("scope","provider","issuer","subject");--> statement-breakpoint
CREATE INDEX "external_identity_subject_idx" ON "external_identity" USING btree ("subject_id","scope");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_provider_tenant_key_uq" ON "identity_provider" USING btree ("tenant_id","key");