CREATE INDEX `idx_admin_audit_created` ON `admin_audit` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_ai_requests_user_created` ON `ai_requests` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_ai_requests_created` ON `ai_requests` (`created_at`);