const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const moduleCache = new Map();

function resolveTsPath(request) {
  if (!request.startsWith("@/")) return null;
  const withoutAlias = request.slice(2);
  const base = path.join(root, "src", withoutAlias);
  if (path.extname(base)) return base;
  for (const ext of [".ts", ".tsx"]) {
    if (fs.existsSync(`${base}${ext}`)) return `${base}${ext}`;
  }
  return `${base}.ts`;
}

function loadTsFile(filePath) {
  const fullPath = path.resolve(filePath);
  const cached = moduleCache.get(fullPath);
  if (cached) return cached.exports;

  const source = fs.readFileSync(fullPath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;

  const mod = { exports: {} };
  moduleCache.set(fullPath, mod);
  const localRequire = (request) => {
    const aliasPath = resolveTsPath(request);
    if (aliasPath) return loadTsFile(aliasPath);
    if (request.startsWith(".")) {
      const base = path.resolve(path.dirname(fullPath), request);
      if (path.extname(base)) return loadTsFile(base);
      for (const ext of [".ts", ".tsx", ".js", ".cjs"]) {
        if (fs.existsSync(`${base}${ext}`)) return ext === ".ts" || ext === ".tsx" ? loadTsFile(`${base}${ext}`) : require(`${base}${ext}`);
      }
    }
    return require(request);
  };

  new Function("require", "module", "exports", "__dirname", "__filename", output)(
    localRequire,
    mod,
    mod.exports,
    path.dirname(fullPath),
    fullPath
  );
  return mod.exports;
}

const { splitLineTextForInbox } = loadTsFile(path.join(root, "src/lib/line-inbox/split-line-text.ts"));
const { buildFallbackAnalyzeItemsFromRawText } = loadTsFile(
  path.join(root, "src/lib/line-inbox/fallback-analyze-items.ts")
);
const {
  buildLineApprovalAcknowledgementText,
  buildLineCarDisplayLabel,
  buildLineOrderSearchRef,
  buildLineOrderReviewUrl,
} = loadTsFile(path.join(root, "src/lib/line-inbox/acknowledgement.ts"));

function assertItems(input, expectedItems, label) {
  const result = splitLineTextForInbox(input);
  assert.deepStrictEqual(result.items, expectedItems, label);
  return result;
}

assertItems("แต่งเหมือนรูปทุกอย่าง!!! / ยกเลิกติดกันแมลง", [
  "แต่งเหมือนรูปทุกอย่าง",
  "ยกเลิกติดกันแมลง",
], "splits photo-style work plus cancellation");

const raptor = assertItems(
  [
    "ทะเบียน 51072 RAPTOR 4WD 2.0 RT AT Double_Cab GRAY 26",
    "เพิ่ม",
    "สปอร์ตบาร์เอาของทะเบียน 31440 ในสติ๊ก YAHYA นะคะ แจ้งทะเบียนผิดค่ะ",
  ].join("\n"),
  ["สปอร์ตบาร์เอาของทะเบียน 31440 ในสติ๊ก YAHYA นะคะ แจ้งทะเบียนผิดค่ะ"],
  "keeps other car number inside work item"
);
assert(raptor.ignored_vehicle_spec_lines.some((line) => line.includes("51072")), "51072 line is vehicle context");
assert(raptor.ignored_noise_lines.includes("เพิ่ม"), "standalone เพิ่ม is control/noise");

assertItems(
  ["95295 TRAVO 4WD 2.8 4TREX AT Standard SILVER Mar26", "คิ้วล้อมาแล้ว ไปเบิกกับพี่ตูน"].join("\n"),
  ["คิ้วล้อมาแล้ว ไปเบิกกับพี่ตูน"],
  "extracts single work line after stock/spec context"
);

assertItems(
  [
    "1นค-8637 COMMUTER 2WD 3.0 No MT VAN WHITE Feb18",
    "เก็บงาน รอส่ง รถมีตรวจเคนย่า รอแจ้งกรอไมล์ อีกที",
    "เอารถไปเช็คเรื่องเบาะ พื้น ถ้ามีอะไรเสียจัดการด้วย",
  ].join("\n"),
  [
    "เก็บงาน รอส่ง",
    "รถมีตรวจเคนย่า",
    "รอแจ้งกรอไมล์อีกที",
    "เอารถไปเช็คเรื่องเบาะ พื้น",
    "ถ้ามีอะไรเสียจัดการด้วย",
  ],
  "splits multi-command commuter text"
);

const withPhotoMarker = assertItems(
  [
    "ทะเบียน กท-2692 ROCCO PRE 2.4 Hight AT Double_Cab PEARL_WHITE Aug20",
    "*แต่งเหมือนรูปทุกอย่าง!!!* / -ยกเลิกติดกันแมลง+กันสาด",
    "[LINE image]",
  ].join("\n"),
  ["แต่งเหมือนรูปทุกอย่าง", "ยกเลิกติดกันแมลง+กันสาด"],
  "ignores LINE image marker as attachment context"
);
assert(!withPhotoMarker.items.some((item) => /LINE image/i.test(item)), "LINE image marker is not a work item");

const koTho2692Text = [
  "ทะเบียน กท-2692 ROCCO PRE 2.4 Hight AT Double_Cab PEARL_WHITE Aug20",
  "แต่งเหมือนรูปทุกอย่าง!!!",
  "ยกเลิกติดกันแมลง+กันสาด",
  "เปลี่ยนแม็ก+ยาง ตามรูป",
  "แต่งเป็นรถเดิมตามรูป",
  "กรอไมล์ 38,300 กม.",
  "เก็บงานให้ละเอียดที่สุด",
  "[LINE image]",
].join("\n");
const koTho2692Expected = [
  "แต่งเหมือนรูปทุกอย่าง",
  "ยกเลิกติดกันแมลง+กันสาด",
  "เปลี่ยนแม็ก+ยาง ตามรูป",
  "แต่งเป็นรถเดิมตามรูป",
  "กรอไมล์ 38,300 กม.",
  "เก็บงานให้ละเอียดที่สุด",
];
const koTho2692 = assertItems(koTho2692Text, koTho2692Expected, "extracts กท-2692 photo work text");
assert(!koTho2692.items.some((item) => /LINE image/i.test(item)), "กท-2692 LINE image marker is not a work item");
assert.deepStrictEqual(
  buildFallbackAnalyzeItemsFromRawText(koTho2692Text, [], true).map((item) => item.suggested_item_name),
  koTho2692Expected,
  "fallback analyze items recover action rows when analyze_payload.items is empty"
);

const koTho2692CarLabel = buildLineCarDisplayLabel({
  plate: "กท-2692",
  title: "กท-2692 ROCCO PRE 2.4 Hight AT Double_Cab PEARL_WHITE Aug20",
});
assert.strictEqual(
  koTho2692CarLabel,
  "กท-2692 ROCCO PRE 2.4 Hight AT Double_Cab PEARL_WHITE Aug20",
  "car display label does not duplicate plate when spec already starts with plate"
);
assert.strictEqual(
  buildLineCarDisplayLabel({
    plate: "กท-2692",
    title: "กท-2692 กท-2692 ROCCO PRE 2.4 Hight AT Double_Cab PEARL_WHITE Aug20",
  }),
  "กท-2692 ROCCO PRE 2.4 Hight AT Double_Cab PEARL_WHITE Aug20",
  "car display label collapses duplicate leading plate"
);
assert.strictEqual(buildLineOrderSearchRef("4ฒญ-6286"), "6286", "search ref uses digits after Thai plate hyphen");
assert.strictEqual(buildLineOrderSearchRef("กท-2692"), "2692", "search ref uses digits after short Thai plate hyphen");
assert.strictEqual(buildLineOrderSearchRef("1นค-8637"), "8637", "search ref handles leading digit Thai plate");
assert.strictEqual(buildLineOrderSearchRef("51072"), "51072", "search ref keeps numeric stock value");
assert.strictEqual(buildLineOrderSearchRef("95295"), "95295", "search ref keeps numeric ref value");
assert.strictEqual(
  buildLineOrderSearchRef("กท-2692 ROCCO PRE 2.4 Hight AT Double_Cab PEARL_WHITE Aug20"),
  "2692",
  "search ref extracts plate from display label without using full spec"
);
assert.strictEqual(
  buildLineOrderSearchRef("ROCCO PRE 2.4 Hight AT Double_Cab PEARL_WHITE Aug20"),
  "",
  "search ref does not use full spec when no plate/ref exists"
);

const koTho2692ReviewUrl = buildLineOrderReviewUrl({
  carRowId: "64ceddf5-2f7b-4e63-b8aa-71cf6d8d537b",
  plate: "กท-2692",
});
assert(koTho2692ReviewUrl.includes("load=full"), "review URL keeps full-load mode");
assert(!koTho2692ReviewUrl.includes("focusCar="), "review URL does not use focusCar for LINE replies");
assert.strictEqual(new URL(koTho2692ReviewUrl).searchParams.get("search"), "2692", "review URL searches by short plate ref");
const sampleThaiPlateReviewUrl = buildLineOrderReviewUrl({
  carRowId: "ignored-row-id",
  plate: "4ฒญ-6286",
});
assert.strictEqual(
  sampleThaiPlateReviewUrl,
  "https://used-car-export-dashboard.vercel.app/m/orders?load=full&search=6286",
  "review URL encodes Thai plate search link"
);

const approvalReply = buildLineApprovalAcknowledgementText({
  carTitle: koTho2692CarLabel,
  reviewUrl: koTho2692ReviewUrl,
  approvedItems: [
    { name: "แต่งเหมือนรูปทุกอย่าง", assignee: "PREW", status: "สั่ง" },
    { name: "ยกเลิกติดกันแมลง+กันสาด", assignee: "", status: "เช็ค" },
    { name: "เปลี่ยนแม็ก+ยาง ตามรูป", assignee: "AOR", status: "" },
  ],
});
assert(approvalReply.includes("รถ: กท-2692 ROCCO PRE"), "approval reply includes non-duplicated car label");
assert(!approvalReply.includes("กท-2692 กท-2692 ROCCO"), "approval reply does not duplicate plate");
assert(approvalReply.includes("บันทึกงานเรียบร้อย"), "approval reply uses compact saved header");
assert(approvalReply.includes("รายการ:"), "approval reply uses compact item header");
assert(approvalReply.includes("1. แต่งเหมือนรูปทุกอย่าง : PREW/สั่ง"), "approval reply uses compact assignee/status format");
assert(approvalReply.includes("2. ยกเลิกติดกันแมลง+กันสาด : ยังไม่ระบุ/เช็ค"), "approval reply shows compact missing-assignee fallback");
assert(approvalReply.includes("3. เปลี่ยนแม็ก+ยาง ตามรูป : AOR/ยังไม่ระบุ"), "approval reply shows compact missing-status fallback");
assert(!approvalReply.includes("ผู้รับผิดชอบ:"), "approval reply does not use verbose assignee label");
assert(!approvalReply.includes("สถานะ:"), "approval reply does not use verbose status label");
assert(approvalReply.includes("ดูงาน:"), "approval reply uses compact review link label");
assert(!approvalReply.includes("focusCar="), "approval reply does not include unstable focusCar link");
assert(approvalReply.includes("search=2692"), "approval reply includes short search deep link");

const pendingQueueRoute = fs.readFileSync(
  path.join(root, "src/app/api/line-inbox/pending-queue/route.ts"),
  "utf8"
);
for (const token of [
  "findFollowingImageContexts",
  "canBuildFallbackPayloadForRow",
  "buildFallbackAnalyzePayloadFromRawText",
  "fallbackTitle",
  "rawTextPreview",
  "relatedPhotoIds",
  "linePhotoCount",
  "extractionStatus",
  "matchStatus",
  "buildFallbackAnalyzeItemsFromRawText",
  "action_line_count: actionEntriesForMessage.length",
]) {
  assert(pendingQueueRoute.includes(token), `pending queue exposes ${token}`);
}
assert(
  pendingQueueRoute.includes("isLineImageOnlyText(row.raw_text) && related"),
  "pending queue groups image rows under the previous text row"
);
const pendingSaveRoute = fs.readFileSync(
  path.join(root, "src/app/api/line-inbox/pending-save/route.ts"),
  "utf8"
);
const lineInboxToolbar = fs.readFileSync(
  path.join(root, "src/components/orders/mobile-v2/line-inbox-ai-toolbar.tsx"),
  "utf8"
);
assert(
  pendingSaveRoute.includes("buildFallbackAnalyzePayloadFromRawText"),
  "pending-save accepts fallback item indexes from old/no-payload LINE text rows"
);
assert(
  lineInboxToolbar.includes('${index + 1}. ${line.name.trim() || "-"} : ${assignee}/${status}'),
  "copy-ready UI reply uses compact assignee/status format"
);
assert(
  !lineInboxToolbar.includes("owner: ${assignee}"),
  "copy-ready UI reply does not use verbose English owner label"
);
assert(
  !lineInboxToolbar.includes("ผู้รับผิดชอบ: ${assignee}"),
  "copy-ready UI reply does not use verbose Thai assignee label"
);
assert(
  !lineInboxToolbar.includes('url.searchParams.set("focusCar"'),
  "copy-ready UI reply uses search-only review links"
);
assert(pendingSaveRoute.includes("assignee_staff: String(actionRow.assignee_staff"), "pending-save receives selected assignee");
assert(pendingSaveRoute.includes("item_status: String(actionRow.item_status"), "pending-save receives selected status");
assert(pendingSaveRoute.includes("saved_items: saved.map"), "pending-save response returns saved item rows");
assert(pendingSaveRoute.includes("assignee_staff: String(actionable[index]?.assignee_staff"), "pending-save response includes assignee");
assert(pendingSaveRoute.includes("status: String(actionable[index]?.item_status"), "pending-save response includes status");
assert(pendingSaveRoute.includes("buildLineOrderReviewUrl"), "pending-save reply uses search review link");
assert(
  pendingQueueRoute.includes("รูปจาก LINE ยังไม่ผูกกับข้อความ/รถ"),
  "image-only queue card has a non-blank fallback title"
);

console.log("line-inbox smoke tests passed");
