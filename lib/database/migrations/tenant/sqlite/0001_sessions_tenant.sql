CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`sid` text NOT NULL,
	`subject_id` text NOT NULL,
	`scope` text DEFAULT 'tenant' NOT NULL,
	`secret_hash` text NOT NULL,
	`generation` integer DEFAULT 1 NOT NULL,
	`previous_secret_hash` text,
	`rotated_at` integer,
	`last_used_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`idle_expires_at` integer NOT NULL,
	`absolute_expires_at` integer NOT NULL,
	`revoked_at` integer,
	`revoked_reason` text,
	`ip` text,
	`user_agent` text,
	`impersonation_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_sid_uq` ON `session` (`sid`);--> statement-breakpoint
CREATE INDEX `session_secret_idx` ON `session` (`secret_hash`);--> statement-breakpoint
CREATE INDEX `session_previous_secret_idx` ON `session` (`previous_secret_hash`);--> statement-breakpoint
CREATE INDEX `session_subject_idx` ON `session` (`subject_id`,`revoked_at`);--> statement-breakpoint
CREATE INDEX `session_absolute_expires_idx` ON `session` (`absolute_expires_at`);