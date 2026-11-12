CREATE TABLE `admin_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`target_id` text NOT NULL,
	`details` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `payment_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text DEFAULT 'CNY' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer NOT NULL,
	`paid_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `site_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `accounts` ADD `status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `accounts` ADD `daily_limit` integer;--> statement-breakpoint
ALTER TABLE `ai_requests` ADD `model` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_requests` ADD `status` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_requests` ADD `http_status` integer;--> statement-breakpoint
ALTER TABLE `ai_requests` ADD `duration_ms` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_requests` ADD `created_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_requests` ADD `estimated_cost_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_requests` ADD `charged_credits` integer DEFAULT 0 NOT NULL;