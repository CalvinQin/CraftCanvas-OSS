CREATE TABLE `library_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`hash` text NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT '产品实拍' NOT NULL,
	`favorite` integer DEFAULT 0 NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_library_user_created` ON `library_assets` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `username_credentials` (
	`username` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`password_hash` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `username_credentials_user_id_unique` ON `username_credentials` (`user_id`);--> statement-breakpoint
ALTER TABLE `accounts` ADD `username` text;