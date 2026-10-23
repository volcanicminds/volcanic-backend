CREATE TABLE "governance_log" (
	"id" text PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"action" text NOT NULL,
	"outcome" text NOT NULL,
	"intent_id" text,
	"actor_id" text,
	"actor_plane" text,
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
CREATE INDEX "governance_log_action_idx" ON "governance_log" USING btree ("action","occurred_at");--> statement-breakpoint
-- Written by hand, drizzle-kit does not generate it: the database refuses to rewrite the
-- governance log. The tenant set has the same block; scripts/check-migration-sets.mjs
-- refuses a set that creates the table without it.
CREATE FUNCTION "governance_log_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'governance_log is append-only: % refused', TG_OP;
END
$$;--> statement-breakpoint
CREATE TRIGGER "governance_log_append_only" BEFORE UPDATE OR DELETE OR TRUNCATE ON "governance_log" FOR EACH STATEMENT EXECUTE FUNCTION "governance_log_append_only"();--> statement-breakpoint
ALTER TABLE "governance_log" ENABLE ALWAYS TRIGGER "governance_log_append_only";