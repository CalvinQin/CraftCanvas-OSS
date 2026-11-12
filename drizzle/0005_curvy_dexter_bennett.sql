ALTER TABLE `ai_requests` ADD `input_tokens` integer;--> statement-breakpoint
ALTER TABLE `ai_requests` ADD `output_tokens` integer;--> statement-breakpoint
ALTER TABLE `ai_requests` ADD `cached_tokens` integer;--> statement-breakpoint
ALTER TABLE `ai_requests` ADD `reasoning_tokens` integer;--> statement-breakpoint
ALTER TABLE `ai_requests` ADD `total_tokens` integer;--> statement-breakpoint
ALTER TABLE `ai_requests` ADD `cost_usd_micros` integer;--> statement-breakpoint
ALTER TABLE `ai_requests` ADD `cost_status` text DEFAULT 'missing_usage' NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_requests` ADD `usage_snapshot` text;--> statement-breakpoint
ALTER TABLE `ai_requests` ADD `price_snapshot` text;--> statement-breakpoint
ALTER TABLE `ai_requests` ADD `provider_response_id` text;