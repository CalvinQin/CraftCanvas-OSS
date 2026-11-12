CREATE TABLE `workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`snapshot_key` text NOT NULL,
	`updated_at` integer NOT NULL,
	`node_count` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_workflows_user_updated` ON `workflows` (`user_id`,`updated_at`);