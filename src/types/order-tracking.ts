export type OrderTrackingSaleStatusSummary = {
  ทั้งหมด: number;
  จอง: number;
  รอส่ง: number;
  ส่งแล้ว: number;
  ว่าง: number;
};

export type OrderTrackingSummarySnapshot = {
  saleStatusCounts: OrderTrackingSaleStatusSummary;
  saleCodeCounts: Record<string, number>;
  staffItemCounts: Record<string, number>;
  itemStatusCounts: Record<string, number>;
  totalOrders: number;
  totalItems: number;
  computedAt: string | null;
};

export type OrderItemFilterIndexLite = {
  status: string;
  assignee_staff: string | null;
  due_date?: string | null;
};
