CREATE TABLE "governance_log" (
	"id" text PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"action" text NOT NULL,
	"outcome" text NOT NULL,
	"intent_id" text,
	"actor_id" text,
	"tenant_id" text,
	"target_id" text,
	"detail" jsonb,
	"request_id" text,
	"ip" text
);
--> statement-breakpoint
CREATE INDEX "governance_log_occurred_idx" ON "governance_log" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "governance_log_tenant_idx" ON "governance_log" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "governance_log_actor_idx" ON "governance_log" USING btree ("actor_id","occurred_at");--> statement-breakpoint
CREATE INDEX "governance_log_action_idx" ON "governance_log" USING btree ("action","occurred_at");