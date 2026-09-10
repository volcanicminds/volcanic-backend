CREATE TABLE `change` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`user_id` text,
	`token_id` text,
	`impersonation_id` text,
	`status` text NOT NULL,
	`entity_name` text NOT NULL,
	`entity_id` text NOT NULL,
	`contents` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `change_entity_idx` ON `change` (`entity_name`,`entity_id`);--> statement-breakpoint
CREATE INDEX `change_created_at_idx` ON `change` (`created_at`);--> statement-breakpoint
CREATE TABLE `destruction_request` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`system_user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`preview` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`export_ref` text
);
--> statement-breakpoint
CREATE INDEX `destruction_tenant_idx` ON `destruction_request` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `destruction_expires_idx` ON `destruction_request` (`expires_at`);--> statement-breakpoint
CREATE TABLE `impersonation` (
	`id` text PRIMARY KEY NOT NULL,
	`system_user_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`target_user_id` text NOT NULL,
	`reason` text NOT NULL,
	`ip` text,
	`user_agent` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE INDEX `impersonation_tenant_idx` ON `impersonation` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `impersonation_actor_idx` ON `impersonation` (`system_user_id`);--> statement-breakpoint
CREATE TABLE `migration` (
	`id` text PRIMARY KEY NOT NULL,
	`set` text NOT NULL,
	`name` text NOT NULL,
	`hash` text NOT NULL,
	`applied_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `migration_set_name_uq` ON `migration` (`set`,`name`);--> statement-breakpoint
CREATE TABLE `system_user` (
	`id` text PRIMARY KEY NOT NULL,
	`external_id` text NOT NULL,
	`email` text NOT NULL,
	`password` text NOT NULL,
	`blocked` integer DEFAULT false NOT NULL,
	`blocked_reason` text,
	`blocked_at` integer,
	`roles` text DEFAULT '[]' NOT NULL,
	`mfa_enabled` integer DEFAULT false NOT NULL,
	`mfa_secret` text,
	`mfa_type` text,
	`mfa_recovery_codes` text,
	`mfa_last_used_counter` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `system_user_email_uq` ON `system_user` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `system_user_external_id_uq` ON `system_user` (`external_id`);--> statement-breakpoint
CREATE TABLE `tenant` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`strategy` text NOT NULL,
	`engine` text NOT NULL,
	`locator` text NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`schema_version` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_slug_uq` ON `tenant` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_locator_uq` ON `tenant` (`engine`,`locator`);--> statement-breakpoint
CREATE INDEX `tenant_status_idx` ON `tenant` (`status`);--> statement-breakpoint
CREATE TABLE `token` (
	`id` text PRIMARY KEY NOT NULL,
	`external_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`blocked` integer DEFAULT false NOT NULL,
	`blocked_reason` text,
	`blocked_at` integer,
	`roles` text DEFAULT '[]' NOT NULL,
	`expires_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `token_external_id_uq` ON `token` (`external_id`);--> statement-breakpoint
CREATE INDEX `token_deleted_at_idx` ON `token` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`external_id` text NOT NULL,
	`username` text,
	`email` text NOT NULL,
	`password` text NOT NULL,
	`confirmed` integer DEFAULT false NOT NULL,
	`confirmed_at` integer,
	`password_changed_at` integer,
	`blocked` integer DEFAULT false NOT NULL,
	`blocked_reason` text,
	`blocked_at` integer,
	`reset_password_token` text,
	`reset_password_token_at` integer,
	`confirmation_token` text,
	`roles` text DEFAULT '[]' NOT NULL,
	`is_founder` integer DEFAULT false NOT NULL,
	`mfa_enabled` integer DEFAULT false NOT NULL,
	`mfa_secret` text,
	`mfa_type` text,
	`mfa_recovery_codes` text,
	`mfa_last_used_counter` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_uq` ON `user` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_external_id_uq` ON `user` (`external_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_username_uq` ON `user` (`username`) WHERE "user"."username" is not null;--> statement-breakpoint
CREATE INDEX `user_reset_token_idx` ON `user` (`reset_password_token`);--> statement-breakpoint
CREATE INDEX `user_confirmation_token_idx` ON `user` (`confirmation_token`);--> statement-breakpoint
CREATE INDEX `user_deleted_at_idx` ON `user` (`deleted_at`);