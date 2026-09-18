CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"sid" text NOT NULL,
	"subject_id" text NOT NULL,
	"scope" text DEFAULT 'tenant' NOT NULL,
	"secret_hash" text NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"previous_secret_hash" text,
	"rotated_at" timestamp with time zone,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"ip" text,
	"user_agent" text,
	"impersonation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "session_sid_uq" ON "session" USING btree ("sid");--> statement-breakpoint
CREATE INDEX "session_secret_idx" ON "session" USING btree ("secret_hash");--> statement-breakpoint
CREATE INDEX "session_previous_secret_idx" ON "session" USING btree ("previous_secret_hash");--> statement-breakpoint
CREATE INDEX "session_subject_idx" ON "session" USING btree ("subject_id","revoked_at");--> statement-breakpoint
CREATE INDEX "session_absolute_expires_idx" ON "session" USING btree ("absolute_expires_at");