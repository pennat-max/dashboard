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

const pendingQueueRoute = fs.readFileSync(
  path.join(root, "src/app/api/line-inbox/pending-queue/route.ts"),
  "utf8"
);
for (const token of [
  "findFollowingImageContexts",
  "fallbackTitle",
  "rawTextPreview",
  "relatedPhotoIds",
  "linePhotoCount",
  "extractionStatus",
  "matchStatus",
]) {
  assert(pendingQueueRoute.includes(token), `pending queue exposes ${token}`);
}
assert(
  pendingQueueRoute.includes("รูปจาก LINE ยังไม่ผูกกับข้อความ/รถ"),
  "image-only queue card has a non-blank fallback title"
);

console.log("line-inbox smoke tests passed");
