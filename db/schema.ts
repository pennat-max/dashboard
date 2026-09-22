import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

const now = sql`CURRENT_TIMESTAMP`;

export const cars = sqliteTable("cars", {
  id: integer("id").primaryKey(),
  row_id: text("row_id").notNull(), spec: text("spec"), status: text("status"), picture: text("picture"),
  advance_date: text("advance_date"), income_date: text("income_date"), plate_number: text("plate_number"), province: text("province"),
  brand: text("brand"), drive_type: text("drive_type"), engine_size: text("engine_size"), grade: text("grade"), gear_type: text("gear_type"),
  cabin: text("cabin"), color: text("color"), manufacture: text("manufacture"), registration: text("registration"),
  engine_number: text("engine_number"), chassis_number: text("chassis_number"), mileage: text("mileage"), agent: text("agent"),
  inspector: text("inspector"), driver_location: text("driver_location"), initial_document: text("initial_document"), document_status: text("document_status"),
  doc_fee: text("doc_fee"), repair_cost: text("repair_cost"), repair_details: text("repair_details"), advance: text("advance"),
  buy_price: text("buy_price"), total_cost: text("total_cost"), part_accessories: text("part_accessories"), web_price_usd: text("web_price_usd"),
  bf_on_web: text("bf_on_web"), requested_modifications: text("requested_modifications"), free: text("free"), booked_date: text("booked_date"),
  sale_price_usd: text("sale_price_usd"), buyer: text("buyer"), sale_support: text("sale_support"), remarks: text("remarks"),
  booked_shipping: text("booked_shipping"), destination_port: text("destination_port"), other: text("other"), shipped: text("shipped"),
  country: text("country"), month: text("month"), c_year: text("c_year"), model: text("model"), model_year: text("model_year"),
  updated_at: text("updated_at").default(now), raw_data: text("raw_data", { mode: "json" }),
}, (t) => [uniqueIndex("cars_row_id_uq").on(t.row_id), index("cars_updated_at_idx").on(t.updated_at), index("cars_plate_idx").on(t.plate_number)]);

export const profiles = sqliteTable("profiles", {
  id: text("id").primaryKey(),
  legacy_user_id: text("legacy_user_id"),
  email: text("email").notNull(),
  role: integer("role").notNull().default(1),
  line_user_id: text("line_user_id"),
  created_at: text("created_at").notNull().default(now),
  updated_at: text("updated_at").notNull().default(now),
}, (t) => [uniqueIndex("profiles_email_uq").on(t.email), uniqueIndex("profiles_legacy_user_uq").on(t.legacy_user_id)]);

export const orderTasks = sqliteTable("order_tasks", {
  id: text("id").primaryKey(), title: text("title").notNull(), description: text("description").notNull().default(""),
  status: text("status").notNull().default("requested"), priority: text("priority").notNull().default("normal"),
  requested_by_role: text("requested_by_role").notNull().default("sales"), assigned_role: text("assigned_role").notNull().default("sales"),
  car_id: integer("car_id"), car_row_id: text("car_row_id"), due_date: text("due_date"), line_thread_ref: text("line_thread_ref"),
  created_at: text("created_at").notNull().default(now), updated_at: text("updated_at").notNull().default(now),
}, (t) => [index("order_tasks_car_row_idx").on(t.car_row_id), index("order_tasks_car_id_idx").on(t.car_id), index("order_tasks_updated_idx").on(t.updated_at)]);

export const orderItems = sqliteTable("order_items", {
  id: text("id").primaryKey(), order_task_id: text("order_task_id").notNull(), label: text("label").notNull(), qty: real("qty").notNull().default(1),
  unit: text("unit"), status: text("status").notNull().default("requested"), created_at: text("created_at").notNull().default(now),
  updated_at: text("updated_at").notNull().default(now), assignee_staff: text("assignee_staff"), outside_supplier: text("outside_supplier"),
  outside_eta_date: text("outside_eta_date"), outside_price: real("outside_price"), outside_note: text("outside_note"), due_date: text("due_date"),
  note: text("note"), label_en: text("label_en"), note_en: text("note_en"), status_changed_at: text("status_changed_at"),
}, (t) => [index("order_items_task_idx").on(t.order_task_id), index("order_items_status_idx").on(t.status)]);

export const orderTaskUpdates = sqliteTable("order_task_updates", {
  id: text("id").primaryKey(), order_task_id: text("order_task_id").notNull(), role: text("role").notNull(), message: text("message").notNull(),
  created_at: text("created_at").notNull().default(now),
}, (t) => [index("order_updates_task_idx").on(t.order_task_id), index("order_updates_created_idx").on(t.created_at)]);

export const orderStorageItems = sqliteTable("order_storage_items", {
  id: text("id").primaryKey(), order_task_id: text("order_task_id").notNull(), item_label: text("item_label"), place: text("place").default("store"),
  storage_type: text("storage_type").notNull().default("removed_part"), due_date: text("due_date"), ownership_transfers_on_due: integer("ownership_transfers_on_due", { mode: "boolean" }).notNull().default(true),
  note: text("note"), created_at: text("created_at").notNull().default(now), updated_at: text("updated_at").notNull().default(now), order_item_id: text("order_item_id"),
  car_row_id: text("car_row_id"), car_id: integer("car_id"), storage_name: text("storage_name"), item_name: text("item_name").notNull(), expire_date: text("expire_date"),
  created_by: text("created_by"), updated_by: text("updated_by"), status: text("status").notNull().default("active"),
}, (t) => [index("storage_task_idx").on(t.order_task_id), index("storage_car_row_idx").on(t.car_row_id)]);

export const orderTrackingStaffRoster = sqliteTable("order_tracking_staff_roster", {
  id: text("id").primaryKey().default("default"), names: text("names", { mode: "json" }).notNull().default([]),
  sale_assignees: text("sale_assignees", { mode: "json" }).notNull().default({}), updated_at: text("updated_at").notNull().default(now),
});

export const orderTrackingItemStatusPrefs = sqliteTable("order_tracking_item_status_prefs", {
  id: text("id").primaryKey().default("default"), roster: text("roster", { mode: "json" }).notNull().default([]),
  labels: text("labels", { mode: "json" }).notNull().default({}), policies: text("policies", { mode: "json" }).notNull().default({}), updated_at: text("updated_at").notNull().default(now),
});

export const orderTrackingPhotos = sqliteTable("order_tracking_photos", {
  id: text("id").primaryKey(), target_type: text("target_type").notNull(), order_item_id: text("order_item_id"), car_row_id: text("car_row_id"), car_id: integer("car_id"),
  storage_bucket: text("storage_bucket").notNull().default("order-tracking-photos"), storage_path: text("storage_path").notNull(), mime_type: text("mime_type"),
  size_bytes: integer("size_bytes"), uploaded_by: text("uploaded_by"), created_at: text("created_at").notNull().default(now), updated_at: text("updated_at").notNull().default(now),
}, (t) => [uniqueIndex("photos_storage_path_uq").on(t.storage_path), index("photos_car_row_idx").on(t.car_row_id), index("photos_item_idx").on(t.order_item_id)]);

export const lineInboxMessages = sqliteTable("line_inbox_messages", {
  id: text("id").primaryKey(), line_message_id: text("line_message_id").notNull(), destination: text("destination"), source_type: text("source_type").notNull(),
  group_id: text("group_id"), user_id: text("user_id"), raw_text: text("raw_text").notNull(), reply_token: text("reply_token"), received_at: text("received_at").notNull().default(now),
  analyze_status: text("analyze_status").notNull().default("pending"), analyze_error: text("analyze_error"), analyze_payload: text("analyze_payload", { mode: "json" }),
  needs_human_review: integer("needs_human_review", { mode: "boolean" }), workflow_status: text("workflow_status").notNull().default("pending"), car_row_id: text("car_row_id"),
  created_at: text("created_at").notNull().default(now), updated_at: text("updated_at").notNull().default(now), image_storage_path: text("image_storage_path"), image_mime_type: text("image_mime_type"),
}, (t) => [uniqueIndex("line_message_id_uq").on(t.line_message_id), index("line_workflow_idx").on(t.workflow_status, t.received_at), index("line_source_idx").on(t.source_type, t.group_id, t.user_id)]);

export const chatHistory = sqliteTable("chat_history", {
  id: integer("id").primaryKey(), user_id: text("user_id").notNull(), role: text("role").notNull(), content: text("content").notNull(), created_at: text("created_at").default(now),
});

export const orderTrackingSummaryCache = sqliteTable("order_tracking_summary_cache", {
  id: integer("id").primaryKey().default(1), sale_status_counts: text("sale_status_counts", { mode: "json" }).notNull().default({}),
  sale_code_counts: text("sale_code_counts", { mode: "json" }).notNull().default({}), staff_item_counts: text("staff_item_counts", { mode: "json" }).notNull().default({}),
  item_status_counts: text("item_status_counts", { mode: "json" }).notNull().default({}), total_orders: integer("total_orders").notNull().default(0),
  total_items: integer("total_items").notNull().default(0), computed_at: text("computed_at").notNull().default(now),
});

export const migrationState = sqliteTable("migration_state", {
  key: text("key").primaryKey(), value: text("value", { mode: "json" }).notNull(), updated_at: text("updated_at").notNull().default(now),
});
