import type { OrderRole, OrderTask, OrderTaskPriority, OrderTaskStatus } from "@/types/order";

const ROLE_SET = new Set<OrderRole>(["sales", "store", "garage"]);
const STATUS_SET = new Set<OrderTaskStatus>([
  "requested",
  "stock_check",
  "ordering",
  "received",
  "pickup",
  "installing",
  "done",
  "cancelled",
]);
const PRIORITY_SET = new Set<OrderTaskPriority>(["low", "normal", "high", "urgent"]);

export function normalizeOrderRole(value: unknown): OrderRole {
  const raw = String(value ?? "").trim().toLowerCase();
  if (ROLE_SET.has(raw as OrderRole)) return raw as OrderRole;
  return "sales";
}

export function normalizeOrderStatus(value: unknown): OrderTaskStatus {
  const raw = String(value ?? "").trim().toLowerCase();
  if (STATUS_SET.has(raw as OrderTaskStatus)) return raw as OrderTaskStatus;
  return "requested";
}

export function normalizeOrderPriority(value: unknown): OrderTaskPriority {
  const raw = String(value ?? "").trim().toLowerCase();
  if (PRIORITY_SET.has(raw as OrderTaskPriority)) return raw as OrderTaskPriority;
  return "normal";
}

export function isOpenOrderStatus(status: OrderTaskStatus): boolean {
  return status !== "done" && status !== "cancelled";
}

export function matchesRole(task: OrderTask, role: OrderRole | "all"): boolean {
  if (role === "all") return true;
  return task.requested_by_role === role || task.assigned_role === role;
}

export function statusColorClass(status: OrderTaskStatus): string {
  if (status === "done") return "bg-emerald-100 text-emerald-900";
  if (status === "cancelled") return "bg-slate-200 text-slate-700";
  if (status === "installing") return "bg-violet-100 text-violet-900";
  if (status === "received" || status === "pickup") return "bg-sky-100 text-sky-900";
  if (status === "ordering" || status === "stock_check") return "bg-amber-100 text-amber-900";
  return "bg-rose-100 text-rose-900";
}
