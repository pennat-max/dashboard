export type OrderRole = "sales" | "store" | "garage";

export type OrderTaskStatus =
  | "requested"
  | "stock_check"
  | "ordering"
  | "received"
  | "pickup"
  | "installing"
  | "done"
  | "cancelled";

export type OrderTaskPriority = "low" | "normal" | "high" | "urgent";

export type OrderTask = {
  id: string;
  title: string;
  description: string;
  status: OrderTaskStatus;
  priority: OrderTaskPriority;
  requested_by_role: OrderRole;
  assigned_role: OrderRole;
  car_id: number | string | null;
  car_row_id: string | null;
  due_date: string | null;
  created_at: string | null;
  updated_at: string | null;
  line_thread_ref: string | null;
};

export type OrderItem = {
  id: string;
  order_task_id: string;
  label: string;
  qty: number;
  unit: string | null;
  status: string;
  created_at: string | null;
  updated_at: string | null;
};

export type OrderTaskUpdate = {
  id: string;
  order_task_id: string;
  role: OrderRole;
  message: string;
  created_at: string | null;
};

export type OrderTaskWithCar = OrderTask & {
  carLabel: string;
  carDisplayId: string;
};

export type MobileOrderFilter = {
  role: OrderRole | "all";
  status:
    | "all"
    | "requested"
    | "stock_check"
    | "ordering"
    | "received"
    | "pickup"
    | "installing"
    | "done"
    | "cancelled";
};

export type OrdersReadResult<T> = {
  data: T;
  error: string | null;
  tableReady: boolean;
};
