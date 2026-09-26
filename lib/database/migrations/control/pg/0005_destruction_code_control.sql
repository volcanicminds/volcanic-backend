ALTER TABLE "destruction_request" ADD COLUMN "code_hash" text;--> statement-breakpoint
ALTER TABLE "destruction_request" ADD COLUMN "code_attempts" integer DEFAULT 0 NOT NULL;