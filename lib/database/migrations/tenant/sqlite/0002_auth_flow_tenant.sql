CREATE TABLE `access_log` (
	`id` text PRIMARY KEY NOT NULL,
	`occurred_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`scope` text DEFAULT 'tenant' NOT NULL,
	`event` text NOT NULL,
	`outcome` text NOT NULL,
	`code` text,
	`subject_id` text,
	`methods` text,
	`provider` text,
	`flow_id` text,
	`sid` text,
	`ip` text
);
--> statement-breakpoint
CREATE INDEX `access_log_occurred_idx` ON `access_log` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `access_log_subject_idx` ON `access_log` (`subject_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `auth_flow` (
	`id` text PRIMARY KEY NOT NULL,
	`flow_id` text NOT NULL,
	`scope` text DEFAULT 'tenant' NOT NULL,
	`subject_id` text,
	`candidate_subject_id` text,
	`secret_hash` text NOT NULL,
	`flow_name` text,
	`stage_index` integer DEFAULT 0 NOT NULL,
	`satisfied` text DEFAULT '[]' NOT NULL,
	`challenge_method` text,
	`challenge_hash` text,
	`challenge_expires_at` integer,
	`challenge_attempts` integer DEFAULT 0 NOT NULL,
	`challenge_sends` integer DEFAULT 0 NOT NULL,
	`last_sent_at` integer,
	`state_hash` text,
	`external` text,
	`external_result` text,
	`version` integer DEFAULT 1 NOT NULL,
	`ip` text,
	`user_agent` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_flow_flow_id_uq` ON `auth_flow` (`flow_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `auth_flow_subject_uq` ON `auth_flow` (`subject_id`,`scope`) WHERE "auth_flow"."subject_id" is not null;--> statement-breakpoint
CREATE INDEX `auth_flow_state_idx` ON `auth_flow` (`state_hash`);--> statement-breakpoint
CREATE INDEX `auth_flow_candidate_idx` ON `auth_flow` (`candidate_subject_id`,`last_sent_at`);--> statement-breakpoint
CREATE INDEX `auth_flow_expires_idx` ON `auth_flow` (`expires_at`);--> statement-breakpoint
CREATE TABLE `external_identity` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text DEFAULT 'tenant' NOT NULL,
	`subject_id` text NOT NULL,
	`provider` text NOT NULL,
	`issuer` text NOT NULL,
	`subject` text NOT NULL,
	`email_at_link` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_used_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_identity_key_uq` ON `external_identity` (`scope`,`provider`,`issuer`,`subject`);--> statement-breakpoint
CREATE INDEX `external_identity_subject_idx` ON `external_identity` (`subject_id`,`scope`);--> statement-breakpoint
ALTER TABLE `session` ADD `auth_methods` text;