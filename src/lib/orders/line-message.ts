import type { OrderItem, OrderTaskWithCar } from "@/types/order";

function itemLines(items: OrderItem[]): string {
  if (items.length === 0) return "- (no items yet)";
  return items
    .map((item, index) => {
      const unit = item.unit ? ` ${item.unit}` : "";
      return `${index + 1}. ${item.label} (${item.qty}${unit}) - ${item.status}`;
    })
    .join("\n");
}

function baseHeader(task: OrderTaskWithCar): string {
  return [
    `Order: ${task.title}`,
    `Task ID: ${task.id}`,
    `Car: ${task.carLabel}`,
    `Car Ref: ${task.carDisplayId}`,
    `Status: ${task.status}`,
    `Priority: ${task.priority}`,
  ].join("\n");
}

export function buildSalesRequestLineMessage(task: OrderTaskWithCar, items: OrderItem[], mobileUrl: string): string {
  return [
    "Sales Request",
    baseHeader(task),
    "",
    "Requested items/work:",
    itemLines(items),
    "",
    `Mobile link: ${mobileUrl}`,
    "Please check stock and confirm next action.",
  ].join("\n");
}

export function buildStoreUpdateLineMessage(task: OrderTaskWithCar, items: OrderItem[], mobileUrl: string): string {
  return [
    "Store Update",
    baseHeader(task),
    "",
    "Current item status:",
    itemLines(items),
    "",
    `Mobile link: ${mobileUrl}`,
    "Store has updated stock/order progress.",
  ].join("\n");
}

export function buildGarageInstallLineMessage(task: OrderTaskWithCar, items: OrderItem[], mobileUrl: string): string {
  return [
    "Garage Install Update",
    baseHeader(task),
    "",
    "Install scope:",
    itemLines(items),
    "",
    `Mobile link: ${mobileUrl}`,
    "Garage pickup/install update posted.",
  ].join("\n");
}
