ALTER TABLE "auth_flow" ADD COLUMN "purpose" text DEFAULT 'login' NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_flow" ADD COLUMN "session_sid" text;--> statement-breakpoint
ALTER TABLE "auth_flow" ADD COLUMN "expected_subject_id" text;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "authenticated_at" timestamp with time zone;