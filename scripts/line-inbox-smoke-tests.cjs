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

const {
  classifyLineNoise,
  isLineInboxNoiseOrSeparatorOnlyText,
  isLineInboxSeparatorOrManualHeaderOnlyText,
  splitLineTextForInbox,
} = loadTsFile(path.join(root, "src/lib/line-inbox/split-line-text.ts"));
const { buildFallbackAnalyzeItemsFromRawText } = loadTsFile(
  path.join(root, "src/lib/line-inbox/fallback-analyze-items.ts")
);
const {
  buildLineApprovalAcknowledgementText,
  buildLineWebhookReceiptAcknowledgementText,
  isLineInboxSystemAcknowledgementText,
} = loadTsFile(path.join(root, "src/lib/line-inbox/acknowledgement.ts"));
const {
  classifyLineSendError,
} = loadTsFile(path.join(root, "src/lib/line/push-message.ts"));
const {
  buildLineCarDisplayLabel,
  buildLineOrderSearchRef,
  buildLineOrderReviewUrl,
} = loadTsFile(path.join(root, "src/lib/line-inbox/review-link.ts"));
const {
  extractLineInboxMileageCarReference,
  extractThaiPlateCandidates,
  lineInboxPlateNumericSuffix,
  scoreLineInboxStockMatch,
  extractStockNumbers,
} = loadTsFile(path.join(root, "src/lib/line-inbox/resolve-car.ts"));
const { deriveLineInboxMatchStatus } = loadTsFile(
  path.join(root, "src/lib/line-inbox/car-match-status.ts")
);
const {
  extractLineQuotedMessageId,
  makeLineReplyCaptureAnalyzePayload,
  withLineReplyAnalyzeContext,
} = loadTsFile(path.join(root, "src/lib/line-inbox/reply-context.ts"));
const {
  parseLineAllowedGroups,
  isLineGroupAllowed,
} = loadTsFile(path.join(root, "src/lib/line/allowed-groups.ts"));
const {
  buildLineAutoSaveAcknowledgementText,
  evaluateLineAutoSaveEligibility,
} = loadTsFile(path.join(root, "src/lib/line-inbox/auto-save.ts"));
const { LINE_AUTO_SAVE_MAX_ITEMS } = loadTsFile(path.join(root, "src/lib/line-inbox/auto-save-safety.ts"));
const {
  LINE_INBOX_QUEUE_REFRESH_MS,
  parseLineInboxQueueFilter,
  lineInboxQueueFilterCounts,
  lineInboxQueueGroupMatchesFilter,
} = loadTsFile(path.join(root, "src/lib/line-inbox/pending-queue-view.ts"));

const specificGroupPolicy = parseLineAllowedGroups("C-test-group,C-real-group");
assert.strictEqual(specificGroupPolicy.allowAllGroups, false, "specific group allow-list does not allow all groups");
assert.strictEqual(isLineGroupAllowed("C-real-group", specificGroupPolicy), true, "specific allowed group passes");
assert.strictEqual(isLineGroupAllowed("C-blocked-group", specificGroupPolicy), false, "unlisted group is blocked");
const emptyGroupPolicy = parseLineAllowedGroups("");
assert.strictEqual(emptyGroupPolicy.allowAllGroups, false, "empty LINE_ALLOWED_GROUP_IDS does not allow all groups");
assert.strictEqual(isLineGroupAllowed("C-any-group", emptyGroupPolicy), false, "empty group policy blocks group capture");
assert.strictEqual(isLineGroupAllowed("C-any-group", parseLineAllowedGroups("*")), true, "wildcard allows all groups");
assert.strictEqual(isLineGroupAllowed("C-any-group", parseLineAllowedGroups("ALL")), true, "ALL allows all groups");
assert.strictEqual(isLineGroupAllowed("", parseLineAllowedGroups("*")), false, "wildcard still requires a real group id");
assert.strictEqual(LINE_INBOX_QUEUE_REFRESH_MS, 5 * 60 * 1000, "AI LINE queue refresh interval is five minutes");
assert.strictEqual(parseLineInboxQueueFilter("manual"), "manual", "manual review queue filter parses");
assert.strictEqual(parseLineInboxQueueFilter("waiting_for_car"), "waiting_for_car", "waiting-for-car queue filter parses");
assert.strictEqual(parseLineInboxQueueFilter("bad-filter"), "all", "unknown queue filter falls back to all");
const queueFilterToday = "2026-05-27";
const queueFilterGroups = [
  {
    total_manual_reviews: 0,
    messages: [{ received_at: "2026-05-27T08:00:00+07:00", action_line_count: 1, new_line_count: 0 }],
    attachments: [],
  },
  {
    total_manual_reviews: 0,
    messages: [{ received_at: "2026-05-26T08:00:00+07:00", action_line_count: 0, new_line_count: 1 }],
    attachments: [],
  },
  {
    total_manual_reviews: 1,
    messages: [{ received_at: "2026-05-25T08:00:00+07:00", needs_human_review: true, extractionStatus: "needs_manual_review" }],
    attachments: [],
  },
  {
    total_manual_reviews: 1,
    matchStatus: "waiting_for_car_record",
    unmatchedReason: "pending_car_record",
    messages: [
      {
        received_at: "2026-05-27T09:00:00+07:00",
        needs_human_review: true,
        extractionStatus: "needs_manual_review",
        matchStatus: "waiting_for_car_record",
        unmatchedReason: "pending_car_record",
      },
    ],
    attachments: [],
  },
];
assert.strictEqual(lineInboxQueueGroupMatchesFilter(queueFilterGroups[0], "today", queueFilterToday), true, "today filter returns today's groups");
assert.strictEqual(lineInboxQueueGroupMatchesFilter(queueFilterGroups[1], "yesterday", queueFilterToday), true, "yesterday filter returns yesterday's groups");
assert.strictEqual(lineInboxQueueGroupMatchesFilter(queueFilterGroups[2], "manual", queueFilterToday), true, "manual filter returns manual review groups");
assert.strictEqual(
  lineInboxQueueGroupMatchesFilter(queueFilterGroups[3], "waiting_for_car", queueFilterToday),
  true,
  "waiting-for-car filter returns pending car record groups"
);
assert.strictEqual(
  lineInboxQueueGroupMatchesFilter(queueFilterGroups[3], "manual", queueFilterToday),
  false,
  "waiting-for-car groups are excluded from manual review filter"
);
assert.deepStrictEqual(
  lineInboxQueueFilterCounts(queueFilterGroups, queueFilterToday),
  { all: 4, today: 1, yesterday: 1, manual: 1, waiting_for_car: 1 },
  "pending queue filter counts are computed from all pending groups"
);
const receiptReply = buildLineWebhookReceiptAcknowledgementText();
assert(receiptReply.includes("รับข้อความแล้วค่ะ"), "webhook receipt acknowledgement says the message was received");
assert(!receiptReply.includes("บันทึกงาน"), "webhook receipt acknowledgement must not claim work was saved");
assert(isLineInboxSystemAcknowledgementText(receiptReply), "webhook receipt acknowledgement is ignored by the analyzer loop guard");
assert.strictEqual(classifyLineSendError(429, "You have reached your monthly limit."), "line_quota_limit", "LINE monthly quota errors are classified");
assert.strictEqual(classifyLineSendError(400, "Bad request"), "line_error", "other LINE errors stay generic");

function assertItems(input, expectedItems, label) {
  const result = splitLineTextForInbox(input);
  assert.deepStrictEqual(result.items, expectedItems, label);
  return result;
}

const separatorOnly = "====================";
const manualHeaderOnly = `${separatorOnly}\n\u0e23\u0e2d\u0e15\u0e23\u0e27\u0e08\u0e14\u0e49\u0e27\u0e22\u0e21\u0e37\u0e2d\n${separatorOnly}`;
const thaiWaitManualReview = "\u0e23\u0e2d\u0e15\u0e23\u0e27\u0e08\u0e14\u0e49\u0e27\u0e22\u0e21\u0e37\u0e2d";
const thaiAddMoreAwning = "\u0e40\u0e1e\u0e34\u0e48\u0e21\u0e40\u0e15\u0e34\u0e21 \u0e01\u0e31\u0e19\u0e2a\u0e32\u0e14";
const thaiAwning = "\u0e01\u0e31\u0e19\u0e2a\u0e32\u0e14";
const thaiFilmAround = "\u0e15\u0e34\u0e14\u0e1f\u0e34\u0e25\u0e4c\u0e21\u0e23\u0e2d\u0e1a\u0e04\u0e31\u0e19";
const thaiDoorPercent = "\u0e1b\u0e23\u0e30\u0e15\u0e39 80%";
assert.strictEqual(classifyLineNoise(separatorOnly), "separator", "equals-only separator is classified");
assert.strictEqual(classifyLineNoise("----------"), "separator", "dash-only separator is classified");
assert.strictEqual(classifyLineNoise("__________"), "separator", "underscore-only separator is classified");
assert.strictEqual(classifyLineNoise("///////"), "separator", "slash-only separator is classified");
assert.strictEqual(classifyLineNoise("....."), "separator", "dot-only separator is classified");
assert.strictEqual(classifyLineNoise("= = = = ="), "separator", "spaced separator is classified");
assert.strictEqual(classifyLineNoise(thaiWaitManualReview), "header", "manual-review header is classified");
assert.strictEqual(classifyLineNoise("\u{1F697}\u{1F6FB}\u2728"), "decoration", "emoji-only line is classified as decoration");
assert.strictEqual(classifyLineNoise("(heart eyes Moon)(heart eyes Moon)"), "decoration", "LINE emoji shortcode-only line is classified as decoration");
assert.deepStrictEqual(
  splitLineTextForInbox("(heart eyes Moon)(heart eyes Moon)").items,
  [],
  "LINE emoji shortcode-only text should not produce actionable work items"
);
assert.strictEqual(
  isLineInboxNoiseOrSeparatorOnlyText("(heart eyes Moon)(heart eyes Moon)"),
  true,
  "LINE emoji shortcode-only text is recognized as queue noise"
);
assert.strictEqual(
  classifyLineNoise("PRO4X 4WD 2.3 AT (2026)"),
  "content",
  "vehicle/year parenthesized text remains content"
);
assert.strictEqual(
  isLineInboxSeparatorOrManualHeaderOnlyText(separatorOnly),
  true,
  "separator-only LINE text is recognized as queue noise"
);
assert.strictEqual(
  isLineInboxNoiseOrSeparatorOnlyText("----------"),
  true,
  "dash separator LINE text is recognized as queue noise"
);
assert.deepStrictEqual(
  splitLineTextForInbox(separatorOnly).items,
  [],
  "separator-only LINE text should not produce actionable work items"
);
assert.deepStrictEqual(
  splitLineTextForInbox("----------").items,
  [],
  "dash-only LINE text should not produce actionable work items"
);
assert.deepStrictEqual(
  splitLineTextForInbox(thaiWaitManualReview).items,
  [],
  "manual-review header alone should not produce actionable work items"
);
assert.strictEqual(
  isLineInboxSeparatorOrManualHeaderOnlyText(manualHeaderOnly),
  true,
  "separator plus manual-review header is recognized as queue noise"
);
assert.deepStrictEqual(splitLineTextForInbox("\u{1F697}\u{1F6FB}\u2728").items, [], "emoji-only line is ignored");
assertItems(thaiAwning, [thaiAwning], "normal work line remains unchanged");
assertItems(thaiAddMoreAwning, [thaiAwning], "header prefix with real work keeps the work part");
const thaiMileage47500 = "\u0e01\u0e23\u0e2d\u0e44\u0e21\u0e25\u0e4c 47,000 KM";
const thaiMileage67500 = "\u0e01\u0e23\u0e2d\u0e44\u0e21\u0e25\u0e4c 67,500 KM";
const thaiMileage39800 = "\u0e01\u0e23\u0e2d\u0e44\u0e21\u0e25\u0e4c 39,800 KM";
assertItems("4380 - 47000 KM.", [thaiMileage47500], "plate/ref plus mileage becomes a mileage work item");
assertItems("4380 - 47,000 KM", [thaiMileage47500], "comma mileage is normalized");
assertItems("\u0e19\u0e02-6866 - 67500 KM", [thaiMileage67500], "Thai plate plus mileage becomes a mileage work item");
assertItems("\u0e01\u0e23\u0e2d\u0e44\u0e21\u0e25\u0e4c 47000 KM", [thaiMileage47500], "mileage without car remains a work item");
assert.strictEqual(extractLineInboxMileageCarReference("4380 - 47000 KM."), "4380", "mileage line keeps first ref as car candidate");
assert.strictEqual(extractLineInboxMileageCarReference("\u0e19\u0e02-6866 - 67500 KM"), "\u0e19\u0e02-6866", "mileage line keeps Thai plate as car candidate");
assert.deepStrictEqual(extractStockNumbers("4380 - 47000 KM."), ["4380"], "mileage number is not a stock/ref candidate");
assert.deepStrictEqual(extractStockNumbers("4380 - 47,000 KM"), ["4380"], "comma mileage number is not a stock/ref candidate");
assert.deepStrictEqual(extractStockNumbers("\u0e19\u0e02-6866 67500 KM"), ["6866"], "Thai plate mileage keeps only plate digits as candidate");
assert.deepStrictEqual(extractStockNumbers("95295 TRAVO 67500 KM"), ["95295"], "stock/spec plus mileage ignores mileage number");
assert.deepStrictEqual(extractStockNumbers("51072 RAPTOR 39,800 km"), ["51072"], "stock/spec plus comma mileage ignores mileage number");
assert.deepStrictEqual(extractStockNumbers("51072 \u0e40\u0e2d\u0e32\u0e02\u0e2d\u0e07 31440"), ["51072", "31440"], "multiple real car refs are not treated as mileage");
assert.strictEqual(lineInboxPlateNumericSuffix("\u0e19\u0e02-6866"), "6866", "Thai plate suffix is extracted");
assert.deepStrictEqual(
  extractThaiPlateCandidates("3\u0e02\u0e07-368 FORTUNER 2WD 2.4 Legender AT SUV WHITE 22 pr97"),
  ["3\u0e02\u0e07-368"],
  "leading-digit Thai plate is extracted as the full plate candidate"
);
assert.deepStrictEqual(
  extractThaiPlateCandidates("\u0e01\u0e01 1234 \u0e40\u0e0a\u0e47\u0e04\u0e23\u0e16"),
  ["\u0e01\u0e011234"],
  "spaced Thai plate is normalized for matching without losing lookup support"
);
assert.deepStrictEqual(
  extractStockNumbers("3\u0e02\u0e07-368 FORTUNER 2WD 2.4 Legender AT SUV WHITE 22 pr97"),
  [],
  "year shorthand and PR/ref text do not become stock candidates for exact Thai plate messages"
);
assert(
  scoreLineInboxStockMatch(
    {
      plate_number: "3\u0e02\u0e07-368",
      spec: "3\u0e02\u0e07-368 FORTUNER 2WD 2.4 Legender AT SUV WHITE 22",
    },
    "368"
  ) > scoreLineInboxStockMatch({ plate_number: "\u0e01\u0e29-3368" }, "368"),
  "exact 3-digit plate suffix outranks longer plate suffix matches"
);
assert(scoreLineInboxStockMatch({ plate_number: "\u0e19\u0e02-6866" }, "6866") > scoreLineInboxStockMatch({ spec: "6866" }, "6866"), "plate suffix outranks loose spec match");
assert.strictEqual(scoreLineInboxStockMatch({ row_id: "a18c7942-10fc-4d32-8059-5b97f86ec9e8" }, "6866"), 0, "UUID row_id substrings do not count as stock/ref matches");
assert.strictEqual(scoreLineInboxStockMatch({ plate_number: "\u0e01\u0e01-6866" }, "6866"), scoreLineInboxStockMatch({ plate_number: "\u0e19\u0e02-6866" }, "6866"), "duplicate suffix plates score equally and remain ambiguous upstream");
const waitingCarRecordText = [
  "44582 Raptor Double Cab Raptor 2.0L 4WD AT BLACK 2025 \u0e1b\u0e49\u0e32\u0e22\u0e41\u0e14\u0e07",
  "\u0e23\u0e16\u0e21\u0e32\u0e2a\u0e31\u0e1b\u0e14\u0e32\u0e2b\u0e4c\u0e04\u0e48\u0e30",
  "\u0e15\u0e34\u0e14\u0e15\u0e31\u0e49\u0e07 \u0e42\u0e23\u0e40\u0e25\u0e2d\u0e23\u0e4c AUTO \u0e22\u0e35\u0e48\u0e2b\u0e49\u0e2d HAMMER",
].join("\n");
assert.deepStrictEqual(
  deriveLineInboxMatchStatus({
    rawText: waitingCarRecordText,
    extractedCarCandidates: [
      {
        text: "44582 Raptor Double Cab Raptor 2.0L 4WD AT BLACK 2025 \u0e1b\u0e49\u0e32\u0e22\u0e41\u0e14\u0e07",
        kind: "vehicle_context",
        confidence: "high",
      },
    ],
    matchReason: 'Multiple spec/model candidates from "44582 Raptor"',
  }),
  { matchStatus: "waiting_for_car_record", unmatchedReason: "pending_car_record" },
  "strong vehicle-looking stock/spec text with no resolved car waits for car record"
);
assert.strictEqual(
  deriveLineInboxMatchStatus({
    rawText: "Raptor Double Cab BLACK \u0e1b\u0e49\u0e32\u0e22\u0e41\u0e14\u0e07",
    extractedCarCandidates: [{ text: "Raptor Double Cab BLACK \u0e1b\u0e49\u0e32\u0e22\u0e41\u0e14\u0e07", kind: "vehicle_context" }],
    matchReason: 'Multiple spec/model candidates from "Raptor Double Cab"',
  }).matchStatus,
  "ambiguous_vehicle",
  "vehicle context without stock/ref stays ambiguous"
);
assert.strictEqual(
  deriveLineInboxMatchStatus({ rawText: "\u0e1d\u0e32\u0e01\u0e14\u0e39\u0e43\u0e2b\u0e49\u0e2b\u0e19\u0e48\u0e2d\u0e22", extractedCarCandidates: [], matchReason: "No car candidates found" }).matchStatus,
  "no_vehicle_context",
  "plain no-car text stays no_vehicle_context"
);
assert.strictEqual(
  deriveLineInboxMatchStatus({ carRowId: "car-row-1", rawText: waitingCarRecordText }).matchStatus,
  "matched",
  "resolved car rows stay matched"
);
assert(
  splitLineTextForInbox(waitingCarRecordText).items.includes("\u0e15\u0e34\u0e14\u0e15\u0e31\u0e49\u0e07 \u0e42\u0e23\u0e40\u0e25\u0e2d\u0e23\u0e4c AUTO \u0e22\u0e35\u0e48\u0e2b\u0e49\u0e2d HAMMER"),
  "waiting-for-record rows keep parsed work items visible"
);
const separatorReset = splitLineTextForInbox(`${thaiFilmAround}\n==========\n${thaiDoorPercent}`);
assert.deepStrictEqual(separatorReset.items, [thaiFilmAround], "separator between blocks does not create a detail item");
assert.strictEqual(separatorReset.grouped_items[0]?.note ?? "", "", "separator resets detail grouping context");
assert(
  separatorReset.ignored_noise_lines.includes(thaiDoorPercent),
  "detail-like line after separator is ignored instead of attaching to previous work"
);

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

const koTho2692AddSectionText = [
  "ทะเบียน กท-2692 ROCCO PRE 2.4 Hight AT Double_Cab PEARL_WHITE Aug20",
  "*เพิ่ม*",
  "",
  "-พรมดำด้ายดำ",
  "YAHYA",
].join("\n");
const koTho2692AddSection = assertItems(
  koTho2692AddSectionText,
  ["พรมดำด้ายดำ"],
  "add section header turns following bullet line into a work item"
);
assert.strictEqual(
  koTho2692AddSection.grouped_items[0]?.note,
  "YAHYA",
  "short customer/requester token after add-section item is stored as note context"
);
assert.strictEqual(
  buildFallbackAnalyzeItemsFromRawText(koTho2692AddSectionText, [], true)[0]?.suggested_note,
  "YAHYA",
  "fallback analyze payload keeps add-section context as suggested note"
);
assertItems(["เพิ่ม", "-กันสาด"].join("\n"), ["กันสาด"], "เพิ่ม section accepts simple bullet accessory work");
assertItems(["เพิ่มเติม", "-โรบาร์แร็ค"].join("\n"), ["โรบาร์แร็ค"], "เพิ่มเติม section accepts following bullet work");

assertItems(
  ["95295 TRAVO 4WD 2.8 4TREX AT Standard SILVER Mar26", "คิ้วล้อมาแล้ว ไปเบิกกับพี่ตูน"].join("\n"),
  ["คิ้วล้อมาแล้ว ไปเบิกกับพี่ตูน"],
  "extracts single work line after stock/spec context"
);

assertItems(
  "95295 TRAVO ป้ายแดง เมือวานมีเปลี่ยนแม้ค ยาง ตามรูป แล้ว",
  ["เปลี่ยนแม้ค ยาง ตามรูป"],
  "strips mixed stock/spec/context prefix from single-line work"
);

assertItems(
  "95295 TRAVO 4WD 2.8 4TREX AT Standard SILVER Mar26 คิ้วล้อมาแล้ว ไปเบิกกับพี่ตูน",
  ["คิ้วล้อมาแล้ว ไปเบิกกับพี่ตูน"],
  "keeps full work phrase after mixed stock/spec prefix"
);

assertItems(
  "1ขฎ-5400 REVO 2WD 2.4 J MT Double_Cab WHITE Jan20 กันสาด",
  ["กันสาด"],
  "strips Thai plate/spec prefix from simple accessory work"
);

assertItems(
  "2026 ซ่อมสี",
  ["2026 ซ่อมสี"],
  "does not strip leading year-like number without vehicle context"
);

assertItems(
  "12345 งานสี",
  ["12345 งานสี"],
  "does not strip leading generic number without vehicle context"
);

assertItems(
  "เปลี่ยนแม้ค ยาง ตามรูป",
  ["เปลี่ยนแม้ค ยาง ตามรูป"],
  "normal work line without car prefix remains unchanged"
);

assertItems("-กลับสี 1G3", ["กลับสี 1G3"], "extracts repaint/color-change work with leading dash bullet");

assertItems("กลับสี 1G3", ["กลับสี 1G3"], "extracts repaint/color-change work without bullet");

assertItems(
  ["วกญ-7660", "MR0JB8DD003529457", "", "-กลับสี 1G3"].join("\n"),
  ["กลับสี 1G3"],
  "extracts repaint/color-change work after plate and chassis context"
);

assertItems("-กันสาด", ["กันสาด"], "leading dash bullet is removed from other valid work lines");

assert.deepStrictEqual(splitLineTextForInbox("1G3").items, [], "plain color code alone is not a work item");

assertItems("รถเข้ามาแล้วจ้า มาเมื่อวาน @Nat💕", ["รถเข้ามาแล้ว"], "extracts arrived-car reply status text");

assert.strictEqual(
  extractLineQuotedMessageId({ quotedMessageId: "468789532432007169", type: "text" }),
  "468789532432007169",
  "extracts LINE quotedMessageId from webhook text message"
);
assert.deepStrictEqual(
  makeLineReplyCaptureAnalyzePayload({
    quotedMessageId: "468789532432007169",
    quoteToken: "quote-token",
  }),
  {
    line_context: {
      context_source: "reply_context",
      quoted_message_id: "468789532432007169",
      quote_token: "quote-token",
    },
  },
  "stores quote metadata in analyze_payload without schema changes"
);
const replyContextPayload = withLineReplyAnalyzeContext(
  {
    detected_car: {
      plate_text: "",
      chassis: "",
      car_row_id: "car-row-parent",
      confidence: 1,
      spec_text: "OVERLAND PLUS D-CAB 2.8 AT 4x4 (2026) ASH",
      sale: "",
    },
    existing_items: [],
    items: [
      {
        raw_text: "รถเข้ามาแล้ว",
        suggested_item_name: "รถเข้ามาแล้ว",
        suggested_category: "status",
        suggested_status: "เช็ค",
        duplicate_status: "new",
        matched_order_item_id: "",
        matched_item_name: "",
        confidence: 0.9,
        reason: "clear reply status",
      },
    ],
    needs_human_review: false,
  },
  {
    context_source: "reply_context",
    quoted_message_id: "468789532432007169",
    source_line_message_id: "468789532432007169",
    source_inbox_message_id: "parent-inbox-row",
    source_car_row_id: "car-row-parent",
    source_raw_text_preview: "MR0YA3AV403022076 / 1GD1958983 22076",
  }
);
assert.strictEqual(replyContextPayload.context_source, "reply_context", "reply context is marked on analyze payload");
assert.strictEqual(replyContextPayload.reply_context.source_car_row_id, "car-row-parent", "reply to matched car inherits car_row_id context");
assert(replyContextPayload.matchReason.includes("reply"), "reply context explains match reason");

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
assert.strictEqual(
  new URL(koTho2692ReviewUrl).searchParams.get("focusCarRowId"),
  "64ceddf5-2f7b-4e63-b8aa-71cf6d8d537b",
  "review URL includes focused car row id"
);
assert.strictEqual(new URL(koTho2692ReviewUrl).searchParams.get("search"), "2692", "review URL searches by short plate ref");
const sampleThaiPlateReviewUrl = buildLineOrderReviewUrl({
  carRowId: "ignored-row-id",
  plate: "4ฒญ-6286",
});
assert.strictEqual(
  sampleThaiPlateReviewUrl,
  "https://used-car-export-dashboard.vercel.app/m/orders?load=full&focusCarRowId=ignored-row-id&search=6286",
  "review URL encodes focused car row id and Thai plate search fallback"
);
const searchOnlyReviewUrl = buildLineOrderReviewUrl({
  plate: "51072",
});
assert.strictEqual(
  searchOnlyReviewUrl,
  "https://used-car-export-dashboard.vercel.app/m/orders?load=full&search=51072",
  "review URL falls back to search when focused car row id is missing"
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
assert(approvalReply.includes("focusCarRowId=64ceddf5-2f7b-4e63-b8aa-71cf6d8d537b"), "approval reply includes focused car row id link");
assert(approvalReply.includes("search=2692"), "approval reply includes short search deep link");
const travo95295ReviewUrl = buildLineOrderReviewUrl({
  carRowId: "a18c7942-10fc-4d32-8059-5b97f86ec9e8",
  plate: "95295 TRAVO 4WD 2.8 4TREX AT Standard SILVER Mar26",
});
assert.strictEqual(
  travo95295ReviewUrl,
  "https://used-car-export-dashboard.vercel.app/m/orders?load=full&focusCarRowId=a18c7942-10fc-4d32-8059-5b97f86ec9e8&search=95295",
  "review URL focuses 95295 by car_row_id with short search fallback"
);

function autoSavePayload(overrides = {}) {
  return {
    detected_car: {
      plate_text: "กจ-2211",
      chassis: "",
      car_row_id: "car-row-2211",
      confidence: 0.95,
      spec_text: "กจ-2211 ROCCO 4WD 2.8 Hight AT Double_Cab BLACK Aug20",
      sale: "GWANG",
    },
    extractedCarCandidates: [{ text: "กจ-2211", confidence: 0.95 }],
    aiTargetCarConfidence: "high",
    existing_items: [],
    ignored_vehicle_spec_lines: [],
    ignored_mention_lines: [],
    ignored_noise_lines: [],
    line_attachments: [],
    items: [
      {
        raw_text: "กลับสี rocco ขาวมุก",
        suggested_item_name: "กลับสี rocco ขาวมุก",
        suggested_category: "paint",
        suggested_status: "ต้องสั่ง",
        duplicate_status: "new",
        matched_order_item_id: "",
        matched_item_name: "",
        confidence: 0.9,
        reason: "clear work",
      },
    ],
    needs_human_review: false,
    ...overrides,
  };
}

const autoSaveRow = {
  id: "line-row-1",
  raw_text: "กจ-2211 ROCCO 4WD 2.8 Hight AT Double_Cab BLACK Aug20\nกลับสี rocco ขาวมุก",
  source_type: "group",
  group_id: "C-real-group",
  received_at: "2026-05-25T05:00:00.000Z",
  workflow_status: "pending",
  analyze_status: "ok",
};

assert.strictEqual(
  evaluateLineAutoSaveEligibility({
    row: { ...autoSaveRow, raw_text: separatorOnly },
    payload: autoSavePayload(),
    enabled: true,
    allowedGroupIds: "C-real-group",
  }).blocked_reason,
  "noise_or_separator",
  "separator-only rows are blocked from auto-save with a specific reason"
);
assert.strictEqual(
  evaluateLineAutoSaveEligibility({
    row: { ...autoSaveRow, raw_text: manualHeaderOnly },
    payload: autoSavePayload(),
    enabled: true,
    allowedGroupIds: "C-real-group",
  }).blocked_reason,
  "noise_or_separator",
  "header-only rows are blocked from auto-save with a specific reason"
);
assert.strictEqual(
  evaluateLineAutoSaveEligibility({
    row: { ...autoSaveRow, raw_text: "(heart eyes Moon)(heart eyes Moon)" },
    payload: autoSavePayload(),
    enabled: true,
    allowedGroupIds: "C-real-group",
  }).blocked_reason,
  "noise_or_separator",
  "LINE emoji shortcode-only rows are blocked from auto-save"
);

assert.strictEqual(
  evaluateLineAutoSaveEligibility({
    row: autoSaveRow,
    payload: autoSavePayload(),
    enabled: true,
    allowedGroupIds: "C-real-group",
  }).eligible,
  true,
  "high-confidence explicit car message is eligible for auto-save"
);
assert.strictEqual(
  evaluateLineAutoSaveEligibility({
    row: autoSaveRow,
    payload: autoSavePayload({ needs_human_review: true }),
    enabled: true,
    allowedGroupIds: "C-real-group",
  }).blocked_reason,
  "needs_human_review",
  "needs_human_review blocks auto-save"
);
assert.strictEqual(
  evaluateLineAutoSaveEligibility({
    row: autoSaveRow,
    payload: autoSavePayload({
      detected_car: { ...autoSavePayload().detected_car, confidence: 0 },
      aiTargetCarConfidence: "0.95",
    }),
    enabled: true,
    allowedGroupIds: "C-real-group",
  }).eligible,
  true,
  "numeric confidence string 0.95 is accepted as high confidence"
);
assert.strictEqual(
  evaluateLineAutoSaveEligibility({
    row: autoSaveRow,
    payload: autoSavePayload({
      detected_car: { ...autoSavePayload().detected_car, confidence: 0 },
      aiTargetCarConfidence: "95%",
    }),
    enabled: true,
    allowedGroupIds: "C-real-group",
  }).eligible,
  true,
  "numeric confidence percentage 95% is accepted as high confidence"
);
assert.strictEqual(
  evaluateLineAutoSaveEligibility({
    row: autoSaveRow,
    payload: autoSavePayload(),
    enabled: false,
    allowedGroupIds: "C-real-group",
  }).blocked_reason,
  "auto_save_disabled",
  "auto-save disabled blocks save"
);
assert.strictEqual(
  evaluateLineAutoSaveEligibility({
    row: autoSaveRow,
    payload: autoSavePayload(),
    enabled: true,
    allowedGroupIds: "C-other-group",
  }).blocked_reason,
  "group_not_allowed",
  "unapproved group blocks auto-save"
);
assert.strictEqual(
  evaluateLineAutoSaveEligibility({
    row: { ...autoSaveRow, raw_text: "[LINE image]" },
    payload: autoSavePayload(),
    enabled: true,
    allowedGroupIds: "*",
  }).blocked_reason,
  "image_only",
  "image-only rows never auto-save"
);
assert.strictEqual(
  evaluateLineAutoSaveEligibility({
    row: autoSaveRow,
    payload: autoSavePayload({ detected_car: { ...autoSavePayload().detected_car, car_row_id: "" } }),
    enabled: true,
    allowedGroupIds: "*",
  }).blocked_reason,
  "missing_car",
  "missing car blocks auto-save"
);
assert.strictEqual(
  evaluateLineAutoSaveEligibility({
    row: autoSaveRow,
    payload: autoSavePayload({
      detected_car: { ...autoSavePayload().detected_car, car_row_id: "" },
      matchStatus: "waiting_for_car_record",
      unmatchedReason: "pending_car_record",
    }),
    enabled: true,
    allowedGroupIds: "*",
  }).blocked_reason,
  "pending_car_record",
  "waiting-for-car-record rows are blocked from auto-save with a specific reason"
);
assert.strictEqual(
  evaluateLineAutoSaveEligibility({
    row: { ...autoSaveRow, raw_text: "4380 - 47000 KM." },
    payload: autoSavePayload({
      detected_car: { ...autoSavePayload().detected_car, car_row_id: "", plate_text: "4380", confidence: 0 },
      extractedCarCandidates: [{ text: "4380", confidence: "high" }],
      aiTargetCarConfidence: "high",
      items: [
        {
          ...autoSavePayload().items[0],
          raw_text: thaiMileage47500,
          suggested_item_name: thaiMileage47500,
          confidence: 0.9,
        },
      ],
    }),
    enabled: true,
    allowedGroupIds: "*",
  }).blocked_reason,
  "missing_car",
  "mileage item without matched car remains blocked from auto-save"
);
assert.strictEqual(
  evaluateLineAutoSaveEligibility({
    row: autoSaveRow,
    payload: autoSavePayload({
      context_source: "reply_context",
      reply_context: {
        context_source: "reply_context",
        quoted_message_id: "quoted-parent-without-car-row",
        source_raw_text_preview: "OVERLAND PLUS D-CAB 2.8 AT 4x4 (2026) ASH",
        confidence: "medium",
      },
      detected_car: { ...autoSavePayload().detected_car, car_row_id: "", confidence: 0.4 },
      aiTargetCarConfidence: "medium",
    }),
    enabled: true,
    allowedGroupIds: "*",
  }).blocked_reason,
  "missing_car",
  "reply context without matched car_row_id still blocks auto-save"
);
assert.strictEqual(
  evaluateLineAutoSaveEligibility({
    row: autoSaveRow,
    payload: autoSavePayload({
      items: [
        {
          ...autoSavePayload().items[0],
          raw_text: "ตามรูป",
          suggested_item_name: "ตามรูป",
        },
      ],
    }),
    enabled: true,
    allowedGroupIds: "*",
  }).blocked_reason,
  "vague_item",
  "vague text blocks auto-save"
);
assert.strictEqual(
  evaluateLineAutoSaveEligibility({
    row: autoSaveRow,
    payload: autoSavePayload({
      extractedCarCandidates: [{ text: "51072" }, { text: "31440" }],
      aiTargetCarConfidence: "medium",
    }),
    enabled: true,
    allowedGroupIds: "*",
  }).blocked_reason,
  "multiple_car_candidates",
  "multiple car candidates block auto-save"
);
const duplicateAutoSaveDecision = evaluateLineAutoSaveEligibility({
  row: autoSaveRow,
  payload: autoSavePayload({
    items: [
      {
        ...autoSavePayload().items[0],
        duplicate_status: "duplicate",
        matched_order_item_id: "existing-item-1",
      },
    ],
  }),
  enabled: true,
  allowedGroupIds: "*",
});
assert.strictEqual(duplicateAutoSaveDecision.eligible, true, "exact duplicate with matched item can auto-merge");
assert.strictEqual(
  duplicateAutoSaveDecision.eligible ? duplicateAutoSaveDecision.actions[0].action : "",
  "merge",
  "duplicate auto-save action is merge"
);
assert.strictEqual(
  evaluateLineAutoSaveEligibility({
    row: autoSaveRow,
    payload: autoSavePayload({
      items: [
        {
          ...autoSavePayload().items[0],
          duplicate_status: "possible_duplicate",
          matched_order_item_id: "",
        },
      ],
    }),
    enabled: true,
    allowedGroupIds: "*",
  }).blocked_reason,
  "unsafe_duplicate_status_possible_duplicate",
  "possible duplicate blocks auto-save"
);
assert.strictEqual(
  evaluateLineAutoSaveEligibility({
    row: autoSaveRow,
    payload: autoSavePayload({
      items: [
        {
          ...autoSavePayload().items[0],
          duplicate_status: "unclear",
          matched_order_item_id: "",
        },
      ],
    }),
    enabled: true,
    allowedGroupIds: "*",
  }).blocked_reason,
  "unsafe_duplicate_status_unclear",
  "unclear duplicate status blocks auto-save"
);

const tooManyAutoSaveItems = Array.from({ length: LINE_AUTO_SAVE_MAX_ITEMS }, (_, index) => ({
  ...autoSavePayload().items[0],
  raw_text: `clear work item ${index + 1}`,
  suggested_item_name: `clear work item ${index + 1}`,
  duplicate_status: "new",
  matched_order_item_id: "",
  matched_item_name: "",
  confidence: 0.9,
}));
assert.strictEqual(
  evaluateLineAutoSaveEligibility({
    row: {
      ...autoSaveRow,
      raw_text: `8\u0e01\u0e19-2827 FORTUNER 4WD 3.0 V AT SUV BLUE Jun05\n${tooManyAutoSaveItems
        .map((item) => item.raw_text)
        .join("\n")}`,
    },
    payload: autoSavePayload({ items: tooManyAutoSaveItems }),
    enabled: true,
    allowedGroupIds: "*",
  }).blocked_reason,
  "too_many_items",
  "long LINE messages with too many extracted items block auto-save"
);

const autoSaveReply = buildLineAutoSaveAcknowledgementText({
  carTitle: "กจ-2211 ROCCO 4WD 2.8 Hight AT Double_Cab BLACK Aug20",
  createdItems: [{ name: "กลับสี rocco ขาวมุก", assignee: "PREW", status: "ต้องสั่ง" }],
  updatedItems: [
    {
      item: {
        order_item_id: "existing-1",
        label: "กรอไมล์ 32,000 KM",
        action: "merge",
        assignee_staff: "PREW",
        status: "ต้องสั่ง",
      },
      previous: {
        id: "existing-1",
        label: "กรอไมล์ 32,000 KM",
        status: "เช็ค",
        assignee_staff: "PREW",
      },
    },
  ],
  attachedPhotoCount: 2,
  reviewUrl: "https://used-car-export-dashboard.vercel.app/m/orders?load=full&focusCarRowId=car-row-2211&search=2211",
});
assert(autoSaveReply.includes("บันทึกงานอัตโนมัติแล้ว"), "auto-save reply says the work was auto-saved");
assert(autoSaveReply.includes("งานที่เพิ่ม:"), "auto-save reply includes created section");
assert(autoSaveReply.includes("1. กลับสี rocco ขาวมุก : PREW/ต้องสั่ง"), "auto-save reply includes created item");
assert(autoSaveReply.includes("งานที่อัปเดต:"), "auto-save reply includes updated section");
assert(autoSaveReply.includes("1. กรอไมล์ 32,000 KM : PREW/เช็ค → PREW/ต้องสั่ง"), "auto-save reply includes before/after update");
assert(autoSaveReply.includes("แนบรูปแล้ว 2 รูป"), "auto-save reply includes attached photo count");
assert(autoSaveReply.includes("focusCarRowId=car-row-2211&search=2211"), "auto-save reply includes review deep link");
assert(!autoSaveReply.includes("skipped item"), "auto-save reply does not include skipped/blocked items");

const sectionedApprovalReply = buildLineApprovalAcknowledgementText({
  carTitle: "ขน-4055 RANGER Hi_Rider 2.2 XLT AT Double_Cab GRAY 18",
  reviewUrl: "https://used-car-export-dashboard.vercel.app/m/orders?load=full&focusCarRowId=row-4055&search=4055",
  createdItems: [{ name: "ทำเบาะหนัง", assignee: "PREW", status: "เช็ค" }],
  updatedItems: [
    {
      name: "กรอไมล์ 32,000 KM",
      beforeAssignee: "PREW",
      beforeStatus: "เช็ค",
      afterAssignee: "PREW",
      afterStatus: "ต้องสั่ง",
    },
  ],
  existingItems: [
    { name: "กันสาด", assignee: "PREW", status: "เช็ค" },
    { name: "โรบาร์แร็ค", assignee: "PREW", status: "ต้องสั่ง" },
    { name: "ทำงานสีรอบคัน", assignee: "PREW", status: "เช็ค" },
  ],
});
assert(sectionedApprovalReply.includes("งานใหม่ที่เพิ่ม:"), "sectioned reply has created item heading");
assert(sectionedApprovalReply.includes("1. ทำเบาะหนัง : PREW/เช็ค"), "sectioned reply lists created items compactly");
assert(sectionedApprovalReply.includes("งานที่แก้ไข/อัปเดต:"), "sectioned reply has updated item heading");
assert(
  sectionedApprovalReply.includes("1. กรอไมล์ 32,000 KM : PREW/เช็ค → PREW/ต้องสั่ง"),
  "sectioned reply shows updated item before/after"
);
assert(sectionedApprovalReply.includes("งานเดิมในรถคันนี้:"), "sectioned reply has existing item heading");
assert(sectionedApprovalReply.includes("1. กันสาด : PREW/เช็ค"), "sectioned reply lists existing work");
assert(sectionedApprovalReply.includes("focusCarRowId=row-4055&search=4055"), "sectioned reply keeps review deep link");
assert(!sectionedApprovalReply.includes("รายการ:"), "sectioned reply does not use the legacy generic list heading");
assert(!sectionedApprovalReply.includes("ข้ามรายการนี้"), "sectioned reply excludes skipped/unapproved items");

const newOnlyApprovalReply = buildLineApprovalAcknowledgementText({
  carTitle: "51072 RAPTOR",
  reviewUrl: "https://used-car-export-dashboard.vercel.app/m/orders?load=full&search=51072",
  createdItems: [{ name: "กันสาด", assignee: "", status: "เช็ค" }],
});
assert(newOnlyApprovalReply.includes("งานใหม่ที่เพิ่ม:"), "new-only reply uses created section");
assert(newOnlyApprovalReply.includes("1. กันสาด : ยังไม่ระบุ/เช็ค"), "new-only reply keeps missing assignee fallback");
assert(!newOnlyApprovalReply.includes("งานเดิมในรถคันนี้:"), "new-only reply omits empty existing section");

const cappedExistingReply = buildLineApprovalAcknowledgementText({
  carTitle: "95295 TRAVO",
  existingItems: Array.from({ length: 12 }, (_, index) => ({
    name: `งานเดิม ${index + 1}`,
    assignee: "PREW",
    status: "เช็ค",
  })),
  reviewUrl: travo95295ReviewUrl,
});
assert(cappedExistingReply.includes("งานเดิมในรถคันนี้:"), "existing-only section is rendered when provided");
assert(cappedExistingReply.includes("10. งานเดิม 10 : PREW/เช็ค"), "existing section shows first ten items");
assert(!cappedExistingReply.includes("งานเดิม 11 : PREW/เช็ค"), "existing section hides item eleven by default");
assert(cappedExistingReply.includes("...และอีก 2 รายการ"), "existing section caps long LINE reply lists");

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
  "unmatchedReason",
  "waiting_for_car_record",
  "pending_car_record",
  "buildFallbackAnalyzeItemsFromRawText",
  "action_line_count: actionEntriesForMessage.length",
  "isLineInboxNoiseOrSeparatorOnlyText",
]) {
  assert(pendingQueueRoute.includes(token), `pending queue exposes ${token}`);
}
assert(
  pendingQueueRoute.includes("isLineInboxNoiseOrSeparatorOnlyText(String(row.raw_text"),
  "pending queue hides separator/noise/header-only rows"
);
assert(
  pendingQueueRoute.includes('cleanString(row.workflow_status) !== "pending"'),
  "pending queue hides confirmed/skipped rows even when older rows are selected for context"
);
assert(
  !pendingQueueRoute.includes('gte("received_at"') && !pendingQueueRoute.includes('lte("received_at"'),
  "pending queue API does not default-hide older pending rows by date"
);
assert(
  pendingQueueRoute.includes("LINE_PENDING_QUEUE_ROW_LIMIT = 500") &&
    pendingQueueRoute.includes(".limit(LINE_PENDING_QUEUE_ROW_LIMIT)"),
  "pending queue can return a larger all-pending window"
);
assert(
  pendingQueueRoute.includes('mode === "summary"') &&
    pendingQueueRoute.includes("summarizeQueueGroup") &&
    pendingQueueRoute.includes("filter_counts"),
  "pending queue supports lightweight summary responses with filter counts"
);
assert(
  pendingQueueRoute.includes("parseLineInboxQueueFilter") &&
    pendingQueueRoute.includes("lineInboxQueueGroupMatchesFilter"),
  "pending queue applies server-side all/today/yesterday/manual filters"
);
assert(
  pendingQueueRoute.includes("LINE_PENDING_QUEUE_SUMMARY_ATTACHMENT_LIMIT") &&
    pendingQueueRoute.includes("LINE_PENDING_QUEUE_SUMMARY_RECENT_ATTACHMENT_LIMIT"),
  "pending queue summary caps initial photo payloads"
);
assert(
  pendingQueueRoute.includes("LINE_PENDING_QUEUE_FALLBACK_CONCURRENCY") &&
    pendingQueueRoute.includes("mapLineInboxQueueWithConcurrency") &&
    pendingQueueRoute.includes("fallbackPayloads"),
  "pending queue precomputes fallback analysis with bounded concurrency"
);
assert(
  pendingQueueRoute.includes("isLineImageOnlyText(row.raw_text) && related"),
  "pending queue groups image rows under the previous text row"
);
const pendingSaveRoute = fs.readFileSync(
  path.join(root, "src/app/api/line-inbox/pending-save/route.ts"),
  "utf8"
);
const lineWebhookRoute = fs.readFileSync(
  path.join(root, "src/app/api/line/webhook/route.ts"),
  "utf8"
);
const linePushMessageSource = fs.readFileSync(
  path.join(root, "src/lib/line/push-message.ts"),
  "utf8"
);
const reviewLinkSource = fs.readFileSync(
  path.join(root, "src/lib/line-inbox/review-link.ts"),
  "utf8"
);
const lineInboxToolbar = fs.readFileSync(
  path.join(root, "src/components/orders/mobile-v2/line-inbox-ai-toolbar.tsx"),
  "utf8"
);
const mobileOrderTrackingHome = fs.readFileSync(
  path.join(root, "src/components/orders/mobile-v2/mobile-order-tracking-home.tsx"),
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
  lineInboxToolbar.includes("selectedQueueActionsForInbox(m, fallbackAssignee)"),
  "queue save payload uses the same sale-owner fallback assignee shown in the UI"
);
assert(
  lineInboxToolbar.includes("saveQueueCard(m, fallbackAssignee)"),
  "queue approve action passes the displayed fallback assignee into save"
);
assert(
  lineInboxToolbar.includes("queueActionDraftForLine(line, fallbackAssignee)"),
  "queue duplicate warning uses fallback assignee draft defaults"
);
assert(
  lineInboxToolbar.includes("Math.max(actionCount, newCount) + manualReviewCount"),
  "AI LINE navigator does not double-count action_lines and new_lines"
);
assert(
  lineInboxToolbar.includes('useState<LineInboxQueueDateFilter>("all")'),
  "AI LINE navigator defaults to all pending work"
);
assert(
  lineInboxToolbar.includes('value: "today"') &&
    lineInboxToolbar.includes('value: "yesterday"') &&
    lineInboxToolbar.includes('value: "manual"') &&
    lineInboxToolbar.includes('value: "waiting_for_car"'),
  "AI LINE navigator exposes today/yesterday/manual/waiting-for-car filters"
);
assert(lineInboxToolbar.includes("รอรถเข้า"), "AI LINE navigator shows waiting-for-car filter label");
assert(
  lineInboxToolbar.includes("groupMatchesLineInboxFilter(group, queueDateFilter") &&
    !lineInboxToolbar.includes("groupHasLineWorkToday"),
  "AI LINE navigator no longer defaults to today-only filtering"
);
assert(
  lineInboxToolbar.includes("LINE_INBOX_QUEUE_REFRESH_MS"),
  "AI LINE pending queue refreshes every five minutes"
);
assert(
  lineInboxToolbar.includes("mode: \"summary\"") &&
    lineInboxToolbar.includes("filter: queueDateFilter") &&
    lineInboxToolbar.includes("AbortController"),
  "AI LINE drawer fetches the lightweight filtered queue with a timeout"
);
assert(
  lineInboxToolbar.includes("const nextDrafts: Record<string, QueueActionDraft> = { ...prev }") &&
    lineInboxToolbar.includes("const nextDes: Record<string, Set<number>> = { ...prev }"),
  "AI LINE auto-refresh preserves staged action drafts and deselections by row id"
);
assert(lineInboxToolbar.includes("รีเฟรช"), "AI LINE drawer keeps a manual refresh button");
assert(
  !lineInboxToolbar.includes("owner: ${assignee}"),
  "copy-ready UI reply does not use verbose English owner label"
);
assert(
  !lineInboxToolbar.includes("ผู้รับผิดชอบ: ${assignee}"),
  "copy-ready UI reply does not use verbose Thai assignee label"
);
assert(
  reviewLinkSource.includes('url.searchParams.set("focusCarRowId"') &&
    lineInboxToolbar.includes("buildLineOrderReviewUrl"),
  "copy-ready UI reply uses the shared focused car row id link helper"
);
assert(
  mobileOrderTrackingHome.includes('params.get("focusCarRowId")') &&
  mobileOrderTrackingHome.includes('params.get("aiLineCar")'),
  "orders page reads focusCarRowId deep links with aiLineCar compatibility"
);
assert(
  mobileOrderTrackingHome.includes("deepLinkSetupRef.current = false") &&
    mobileOrderTrackingHome.includes("deepLinkScrollDoneRef.current = false"),
  "orders page resets deep link focus when query params change"
);
assert(
  mobileOrderTrackingHome.includes("void focusLineInboxCar({"),
  "orders page reuses AI LINE car focus handler for deep links"
);
assert(
  mobileOrderTrackingHome.includes("useState(() => sanitizeVehicleSearchInput(deepLinkParams.search))"),
  "orders page initializes search input from query search param"
);
assert(
  mobileOrderTrackingHome.includes("setVehicleSearch((prev) => (prev === querySearch ? prev : querySearch))"),
  "orders page applies query search param on client navigation"
);
assert(pendingSaveRoute.includes("assignee_staff: String(actionRow.assignee_staff"), "pending-save receives selected assignee");
assert(pendingSaveRoute.includes("item_status: String(actionRow.item_status"), "pending-save receives selected status");
assert(pendingSaveRoute.includes("saved_items: saved.map"), "pending-save response returns saved item rows");
assert(pendingSaveRoute.includes("createdItems = saved.filter"), "pending-save separates created items for LINE reply");
assert(pendingSaveRoute.includes("updatedItems = saved.filter"), "pending-save separates updated/merged items for LINE reply");
assert(pendingSaveRoute.includes("fetchExistingApprovalItemsForReply"), "pending-save fetches existing work for LINE reply");
assert(pendingSaveRoute.includes("existingApprovalItemsFromPayloadForReply"), "pending-save has a safe existing-work fallback");
assert(pendingSaveRoute.includes("assignee_staff: item.assignee_staff"), "pending-save response includes persisted assignee");
assert(pendingSaveRoute.includes("status: item.status"), "pending-save response includes persisted status");
assert(pendingSaveRoute.includes("buildLineOrderReviewUrl"), "pending-save reply uses search review link");
assert(pendingSaveRoute.includes("LINE_AUTO_REPLY_AFTER_APPROVE_ENABLED"), "manual approval reply is gated by its own env flag");
assert(pendingSaveRoute.includes("pushLineTextMessage"), "manual approval reply calls the LINE push API helper");
assert(pendingSaveRoute.includes("classifyLineSendError"), "manual approval reply classifies LINE send failures");
assert(pendingSaveRoute.includes("error_reason: errorReason"), "manual approval reply returns a machine-readable error reason");
assert(pendingSaveRoute.includes("error_status: sent.status"), "manual approval reply returns the LINE error status");
assert(pendingSaveRoute.includes("copy_ready_reply_text: acknowledged.replyText"), "pending-save returns copy-ready fallback text");
assert(pendingSaveRoute.includes("autoReply: acknowledged.autoReply"), "pending-save returns camel-case autoReply fallback status");
assert(
  pendingSaveRoute.includes("manual approval LINE acknowledgement not sent") &&
    pendingSaveRoute.includes("manual approval LINE acknowledgement sent"),
  "manual approval reply logs masked send results for production diagnostics"
);
assert(pendingSaveRoute.includes("maskLineTarget"), "manual approval reply masks LINE targets in logs");
assert(linePushMessageSource.includes("replyLineTextMessage"), "LINE helper supports replyToken receipt replies");
assert(linePushMessageSource.includes("https://api.line.me/v2/bot/message/reply"), "LINE reply helper uses the LINE reply API");
assert(linePushMessageSource.includes("classifyLineSendError"), "LINE helper exposes send error classification");
assert(lineWebhookRoute.includes("LINE_WEBHOOK_RECEIPT_REPLY_ENABLED"), "webhook receipt replies are gated by env");
assert(lineWebhookRoute.includes("replyLineTextMessage"), "webhook receipt uses LINE replyToken API");
assert(lineWebhookRoute.includes("buildLineWebhookReceiptAcknowledgementText"), "webhook receipt uses safe receipt-only text");
assert(lineWebhookRoute.includes("isLineInboxSystemAcknowledgementText(text)"), "webhook ignores bot/system acknowledgement text");
assert(
  lineWebhookRoute.includes("isLineInboxNoiseOrSeparatorOnlyText(params.text)"),
  "webhook skips separator/noise-only receipt replies"
);
assert(lineWebhookRoute.includes("duplicate: captured.duplicate"), "webhook de-dupes receipt replies by insert duplicate state");
assert(
    lineInboxToolbar.includes("line_quota_limit") &&
    lineInboxToolbar.includes("กรุณากด Copy แล้ววางใน LINE เอง") &&
    lineInboxToolbar.includes("copy_ready_reply_text") &&
    lineInboxToolbar.includes("resultForMessage?.auto_reply ?? resultForMessage?.autoReply"),
  "LINE queue UI shows copy fallback when approval push fails because quota is exhausted"
);
assert(
  pendingSaveRoute.includes("assignee_staff: item.assignee_staff"),
  "pending-save passes selected assignee into persistence"
);
const analyzePendingJobSource = fs.readFileSync(
  path.join(root, "src/lib/line-inbox/analyze-pending-job.ts"),
  "utf8"
);
const autoSaveSource = fs.readFileSync(
  path.join(root, "src/lib/line-inbox/auto-save.ts"),
  "utf8"
);
assert(analyzePendingJobSource.includes("maybeAutoSaveAnalyzedLineInbox"), "analyze-pending is wired to guarded auto-save");
assert(autoSaveSource.includes("LINE_AUTO_SAVE_ENABLED"), "auto-save is gated by LINE_AUTO_SAVE_ENABLED");
assert(autoSaveSource.includes("LINE_AUTO_SAVE_ALLOWED_GROUP_IDS"), "auto-save has a separate group allow-list");
assert(autoSaveSource.includes("LINE_AUTO_SAVE_REPLY_ENABLED"), "auto-save reply is independently gated");
assert(autoSaveSource.includes("LINE_AUTO_SAVE_DRY_RUN_ENABLED"), "auto-save has a dry-run flag");
assert(autoSaveSource.includes('blocked_reason: "noise_or_separator"'), "auto-save blocks separator/noise/header-only rows");
assert(autoSaveSource.includes('blocked_reason: "too_many_items"'), "auto-save blocks overly large item batches");
assert(autoSaveSource.includes('blocked_reason: "dry_run"'), "dry-run reports planned save without writing");
assert(autoSaveSource.includes("markLineInboxMessageWorkflowConfirmed"), "auto-save marks the source message confirmed for idempotency");
assert(autoSaveSource.includes("ORDER_TRACKING_PHOTOS_TABLE"), "auto-save attaches related LINE photos through order_tracking_photos");
assert(
  autoSaveSource.includes("claimLineInboxMessageForAutoSave") &&
    autoSaveSource.includes('.eq("workflow_status", "pending")') &&
    autoSaveSource.includes('workflow_status: "confirmed"'),
  "auto-save atomically claims the inbox row before writing order_items"
);
assert(
  autoSaveSource.indexOf("const claimed = await claimLineInboxMessageForAutoSave") <
    autoSaveSource.indexOf("const persisted = await persistLineInboxConfirmations"),
  "auto-save lock happens before order_items persistence"
);
assert(
  autoSaveSource.indexOf('params.payload, "saved"') <
    autoSaveSource.indexOf("related = await findRelatedLineAttachments"),
  "auto-save records saved state before optional photo/reply work"
);
assert(autoSaveSource.includes("photo attach failed after save"), "photo attach failure is logged after save without retrying order_items");
assert(autoSaveSource.includes("error_after_lock"), "persist failure after atomic lock records a non-retry error state");
assert(
  pendingSaveRoute.includes("claimPendingInboxForManualSave") &&
    pendingSaveRoute.includes('.eq("workflow_status", "pending")'),
  "manual pending-save uses an atomic pending workflow guard"
);
assert(
  pendingSaveRoute.indexOf("await claimPendingInboxForManualSave") <
    pendingSaveRoute.indexOf("const { order_task_id, saved } = await persistLineInboxConfirmations"),
  "manual pending-save claims the row before writing order_items"
);
const persistConfirm = fs.readFileSync(
  path.join(root, "src/lib/line-inbox/persist-line-inbox-confirm.ts"),
  "utf8"
);
assert(
  persistConfirm.includes("if (assigneeStaff) createPayload.assignee_staff = assigneeStaff"),
  "line inbox persistence writes assignee_staff to order_items"
);
assert(
  persistConfirm.includes("if (assigneeStaff) retryPayload.assignee_staff = assigneeStaff"),
  "line inbox fallback insert still writes assignee_staff when the column is available"
);
assert(
  persistConfirm.includes("if (assigneeNext) retryPatch.assignee_staff = assigneeNext"),
  "line inbox fallback merge still writes assignee_staff when the column is available"
);
assert(
  pendingQueueRoute.includes("รูปจาก LINE ยังไม่ผูกกับข้อความ/รถ"),
  "image-only queue card has a non-blank fallback title"
);

console.log("line-inbox smoke tests passed");
