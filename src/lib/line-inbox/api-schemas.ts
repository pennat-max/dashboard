import { z } from "zod";

/** Accept JSON numbers or numeric strings for car_id */
function optionalPositiveInt() {
  return z.preprocess((val) => {
    if (val === "" || val === null || val === undefined) return undefined;
    const n = typeof val === "number" ? val : Number(String(val).trim());
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return Math.floor(n);
  }, z.number().int().positive().optional());
}

export const lineInboxAnalyzeBodySchema = z.object({
  raw_text: z.string().min(1, "raw_text required").max(100_000),
  line_inbox_message_id: z.string().trim().max(512).optional(),
  car_row_id: z.string().trim().max(512).optional(),
  car_id: optionalPositiveInt(),
  attachments: z.preprocess(
    (val) => (val === null || val === undefined ? [] : val),
    z.array(z.unknown()).max(100)
  ),
});

export type LineInboxAnalyzeBody = z.infer<typeof lineInboxAnalyzeBodySchema>;

const confirmRowSchema = z
  .object({
    action: z.enum(["skip", "create", "merge"]),
    order_item_id: z.union([z.string(), z.null(), z.undefined()]).optional(),
    item_name: z.preprocess(
      (v) => (v === null || v === undefined ? "" : String(v)),
      z.string().max(2000)
    ),
    item_status: z.preprocess(
      (v) => (v === null || v === undefined ? undefined : String(v)),
      z.string().max(500).optional()
    ),
    note: z.preprocess(
      (v) => (v === null || v === undefined ? undefined : String(v)),
      z.string().max(4000).optional()
    ),
    assignee_staff: z.preprocess(
      (v) => (v === null || v === undefined ? undefined : String(v)),
      z.string().max(500).optional()
    ),
    due_date: z.preprocess(
      (v) => (v === null || v === undefined ? undefined : String(v)),
      z.string().max(100).optional()
    ),
  })
  .superRefine((row, ctx) => {
    const oid = row.order_item_id != null ? String(row.order_item_id).trim() : "";
    const name = String(row.item_name ?? "").trim();

    if (row.action === "merge" && !oid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "merge requires order_item_id",
        path: ["order_item_id"],
      });
    }
    if (row.action === "create" && !name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "create requires item_name",
        path: ["item_name"],
      });
    }
  });

export const lineInboxConfirmBodySchema = z
  .object({
    line_inbox_message_id: z.string().trim().max(512).optional(),
    car_row_id: z.union([z.string(), z.null(), z.undefined()]).optional(),
    car_id: optionalPositiveInt(),
    confirmations: z.preprocess(
      (val) => (val === null || val === undefined ? [] : val),
      z.array(confirmRowSchema).max(500)
    ),
  })
  .superRefine((body, ctx) => {
    const rowId = body.car_row_id != null ? String(body.car_row_id).trim() : "";
    if (!rowId && body.car_id == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "car_row_id or car_id required",
        path: ["car_row_id"],
      });
    }
  });

export type LineInboxConfirmBody = z.infer<typeof lineInboxConfirmBodySchema>;

/** Save selected 「งานใหม่」(duplicate_status=new) rows from webhook queue */
export const lineInboxPendingSaveBodySchema = z.object({
  saves: z
    .array(
      z
        .object({
          inbox_message_id: z.string().uuid(),
          item_indices: z.array(z.number().int().nonnegative()).min(1).max(200).optional(),
          skip_all: z.boolean().optional(),
          selected_car_row_id: z.preprocess(
            (v) => (v === null || v === undefined ? undefined : String(v).trim()),
            z.string().max(512).optional()
          ),
          actions: z
            .array(
              z.object({
                item_index: z.number().int().nonnegative(),
                action: z.enum(["skip", "create", "merge"]),
                order_item_id: z.union([z.string(), z.null(), z.undefined()]).optional(),
                item_name: z.preprocess(
                  (v) => (v === null || v === undefined ? undefined : String(v)),
                  z.string().max(2000).optional()
                ),
                item_status: z.preprocess(
                  (v) => (v === null || v === undefined ? undefined : String(v)),
                  z.string().max(500).optional()
                ),
                note: z.preprocess(
                  (v) => (v === null || v === undefined ? undefined : String(v)),
                  z.string().max(4000).optional()
                ),
                assignee_staff: z.preprocess(
                  (v) => (v === null || v === undefined ? undefined : String(v)),
                  z.string().max(500).optional()
                ),
                due_date: z.preprocess(
                  (v) => (v === null || v === undefined ? undefined : String(v)),
                  z.string().max(100).optional()
                ),
              })
            )
            .max(200)
            .optional(),
        })
        .superRefine((block, ctx) => {
          if (block.skip_all) return;
          if ((block.item_indices?.length ?? 0) > 0) return;
          if ((block.actions?.length ?? 0) > 0) return;
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "item_indices, actions, or skip_all required",
            path: ["actions"],
          });
        })
    )
    .min(1)
    .max(50),
});

export type LineInboxPendingSaveBody = z.infer<typeof lineInboxPendingSaveBodySchema>;

export function formatZodIssues(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
}
