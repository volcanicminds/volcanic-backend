ALTER TABLE `destruction_request` ADD `code_hash` text;--> statement-breakpoint
ALTER TABLE `destruction_request` ADD `code_attempts` integer DEFAULT 0 NOT NULL;