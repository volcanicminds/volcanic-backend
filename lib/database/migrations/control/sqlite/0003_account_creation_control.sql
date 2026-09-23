CREATE TABLE `setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_by` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `user` ADD `approved` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `approved_at` integer;