CREATE TABLE `cars` (
	`id` integer PRIMARY KEY NOT NULL,
	`row_id` text NOT NULL,
	`spec` text,
	`status` text,
	`picture` text,
	`advance_date` text,
	`income_date` text,
	`plate_number` text,
	`province` text,
	`brand` text,
	`drive_type` text,
	`engine_size` text,
	`grade` text,
	`gear_type` text,
	`cabin` text,
	`color` text,
	`manufacture` text,
	`registration` text,
	`engine_number` text,
	`chassis_number` text,
	`mileage` text,
	`agent` text,
	`inspector` text,
	`driver_location` text,
	`initial_document` text,
	`document_status` text,
	`doc_fee` text,
	`repair_cost` text,
	`repair_details` text,
	`advance` text,
	`buy_price` text,
	`total_cost` text,
	`part_accessories` text,
	`web_price_usd` text,
	`bf_on_web` text,
	`requested_modifications` text,
	`free` text,
	`booked_date` text,
	`sale_price_usd` text,
	`buyer` text,
	`sale_support` text,
	`remarks` text,
	`booked_shipping` text,
	`destination_port` text,
	`other` text,
	`shipped` text,
	`country` text,
	`month` text,
	`c_year` text,
	`model` text,
	`model_year` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	`raw_data` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cars_row_id_uq` ON `cars` (`row_id`);--> statement-breakpoint
CREATE INDEX `cars_updated_at_idx` ON `cars` (`updated_at`);--> statement-breakpoint
CREATE INDEX `cars_plate_idx` ON `cars` (`plate_number`);--> statement-breakpoint
CREATE TABLE `chat_history` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `line_inbox_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`line_message_id` text NOT NULL,
	`destination` text,
	`source_type` text NOT NULL,
	`group_id` text,
	`user_id` text,
	`raw_text` text NOT NULL,
	`reply_token` text,
	`received_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`analyze_status` text DEFAULT 'pending' NOT NULL,
	`analyze_error` text,
	`analyze_payload` text,
	`needs_human_review` integer,
	`workflow_status` text DEFAULT 'pending' NOT NULL,
	`car_row_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`image_storage_path` text,
	`image_mime_type` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `line_message_id_uq` ON `line_inbox_messages` (`line_message_id`);--> statement-breakpoint
CREATE INDEX `line_workflow_idx` ON `line_inbox_messages` (`workflow_status`,`received_at`);--> statement-breakpoint
CREATE INDEX `line_source_idx` ON `line_inbox_messages` (`source_type`,`group_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `migration_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_task_id` text NOT NULL,
	`label` text NOT NULL,
	`qty` real DEFAULT 1 NOT NULL,
	`unit` text,
	`status` text DEFAULT 'requested' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`assignee_staff` text,
	`outside_supplier` text,
	`outside_eta_date` text,
	`outside_price` real,
	`outside_note` text,
	`due_date` text,
	`note` text,
	`label_en` text,
	`note_en` text,
	`status_changed_at` text
);
--> statement-breakpoint
CREATE INDEX `order_items_task_idx` ON `order_items` (`order_task_id`);--> statement-breakpoint
CREATE INDEX `order_items_status_idx` ON `order_items` (`status`);--> statement-breakpoint
CREATE TABLE `order_storage_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_task_id` text NOT NULL,
	`item_label` text,
	`place` text DEFAULT 'store',
	`storage_type` text DEFAULT 'removed_part' NOT NULL,
	`due_date` text,
	`ownership_transfers_on_due` integer DEFAULT true NOT NULL,
	`note` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`order_item_id` text,
	`car_row_id` text,
	`car_id` integer,
	`storage_name` text,
	`item_name` text NOT NULL,
	`expire_date` text,
	`created_by` text,
	`updated_by` text,
	`status` text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `storage_task_idx` ON `order_storage_items` (`order_task_id`);--> statement-breakpoint
CREATE INDEX `storage_car_row_idx` ON `order_storage_items` (`car_row_id`);--> statement-breakpoint
CREATE TABLE `order_task_updates` (
	`id` text PRIMARY KEY NOT NULL,
	`order_task_id` text NOT NULL,
	`role` text NOT NULL,
	`message` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `order_updates_task_idx` ON `order_task_updates` (`order_task_id`);--> statement-breakpoint
CREATE INDEX `order_updates_created_idx` ON `order_task_updates` (`created_at`);--> statement-breakpoint
CREATE TABLE `order_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'requested' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`requested_by_role` text DEFAULT 'sales' NOT NULL,
	`assigned_role` text DEFAULT 'sales' NOT NULL,
	`car_id` integer,
	`car_row_id` text,
	`due_date` text,
	`line_thread_ref` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `order_tasks_car_row_idx` ON `order_tasks` (`car_row_id`);--> statement-breakpoint
CREATE INDEX `order_tasks_car_id_idx` ON `order_tasks` (`car_id`);--> statement-breakpoint
CREATE INDEX `order_tasks_updated_idx` ON `order_tasks` (`updated_at`);--> statement-breakpoint
CREATE TABLE `order_tracking_item_status_prefs` (
	`id` text PRIMARY KEY DEFAULT 'default' NOT NULL,
	`roster` text DEFAULT '[]' NOT NULL,
	`labels` text DEFAULT '{}' NOT NULL,
	`policies` text DEFAULT '{}' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `order_tracking_photos` (
	`id` text PRIMARY KEY NOT NULL,
	`target_type` text NOT NULL,
	`order_item_id` text,
	`car_row_id` text,
	`car_id` integer,
	`storage_bucket` text DEFAULT 'order-tracking-photos' NOT NULL,
	`storage_path` text NOT NULL,
	`mime_type` text,
	`size_bytes` integer,
	`uploaded_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `photos_storage_path_uq` ON `order_tracking_photos` (`storage_path`);--> statement-breakpoint
CREATE INDEX `photos_car_row_idx` ON `order_tracking_photos` (`car_row_id`);--> statement-breakpoint
CREATE INDEX `photos_item_idx` ON `order_tracking_photos` (`order_item_id`);--> statement-breakpoint
CREATE TABLE `order_tracking_staff_roster` (
	`id` text PRIMARY KEY DEFAULT 'default' NOT NULL,
	`names` text DEFAULT '[]' NOT NULL,
	`sale_assignees` text DEFAULT '{}' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `order_tracking_summary_cache` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`sale_status_counts` text DEFAULT '{}' NOT NULL,
	`sale_code_counts` text DEFAULT '{}' NOT NULL,
	`staff_item_counts` text DEFAULT '{}' NOT NULL,
	`item_status_counts` text DEFAULT '{}' NOT NULL,
	`total_orders` integer DEFAULT 0 NOT NULL,
	`total_items` integer DEFAULT 0 NOT NULL,
	`computed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`legacy_user_id` text,
	`email` text NOT NULL,
	`role` integer DEFAULT 1 NOT NULL,
	`line_user_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_email_uq` ON `profiles` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_legacy_user_uq` ON `profiles` (`legacy_user_id`);