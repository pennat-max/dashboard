CREATE TABLE `line_job_item_status_events` (
	`id` text PRIMARY KEY NOT NULL,
	`item_key` text NOT NULL,
	`group_key` text NOT NULL,
	`inbox_id` text,
	`car_row_id` text,
	`item_index` integer,
	`item_label` text,
	`old_status` text,
	`new_status` text NOT NULL,
	`changed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`changed_by_source` text DEFAULT 'chatgpt_site' NOT NULL,
	`changed_by_id` text,
	`changed_by_name` text,
	`changed_by_email` text,
	`client_context` text
);
--> statement-breakpoint
CREATE INDEX `line_job_event_item_idx` ON `line_job_item_status_events` (`item_key`);--> statement-breakpoint
CREATE INDEX `line_job_event_group_idx` ON `line_job_item_status_events` (`group_key`);--> statement-breakpoint
CREATE INDEX `line_job_event_changed_idx` ON `line_job_item_status_events` (`changed_at`);--> statement-breakpoint
CREATE TABLE `line_job_item_statuses` (
	`item_key` text PRIMARY KEY NOT NULL,
	`group_key` text NOT NULL,
	`inbox_id` text,
	`car_row_id` text,
	`item_index` integer,
	`item_label` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`note` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_by_source` text DEFAULT 'chatgpt_site' NOT NULL,
	`updated_by_id` text,
	`updated_by_name` text,
	`updated_by_email` text
);
--> statement-breakpoint
CREATE INDEX `line_job_status_group_idx` ON `line_job_item_statuses` (`group_key`);--> statement-breakpoint
CREATE INDEX `line_job_status_car_idx` ON `line_job_item_statuses` (`car_row_id`);--> statement-breakpoint
CREATE INDEX `line_job_status_updated_idx` ON `line_job_item_statuses` (`updated_at`);