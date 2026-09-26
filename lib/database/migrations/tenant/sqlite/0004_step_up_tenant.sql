ALTER TABLE `auth_flow` ADD `purpose` text DEFAULT 'login' NOT NULL;--> statement-breakpoint
ALTER TABLE `auth_flow` ADD `session_sid` text;--> statement-breakpoint
ALTER TABLE `auth_flow` ADD `expected_subject_id` text;--> statement-breakpoint
ALTER TABLE `session` ADD `authenticated_at` integer;