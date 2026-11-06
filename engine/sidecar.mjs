// adapter/cli.ts
import { parseArgs } from "node:util";
import { resolve, join as join11 } from "node:path";
import { writeFileSync as writeFileSync4 } from "node:fs";

// adapter/bridge.ts
import { existsSync as existsSync8, readFileSync as readFileSync6 } from "node:fs";
import { dirname as dirname5, isAbsolute, join as join9 } from "node:path";

// adapter/raw.ts
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
function rawRoot() {
  const fromEnv = process.env.JOURNEY_RAW_DIR?.trim();
  if (fromEnv) return fromEnv;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "raw"),
    join(here, "..", "..", "raw"),
    join(process.cwd(), "raw")
  ];
  for (const path of candidates) {
    if (existsSync(join(path, "src", "world.ts"))) return path;
  }
  return candidates[0];
}
async function loadRaw(root = rawRoot()) {
  const worldPath = join(root, "src", "world.ts");
  const configPath = join(root, "src", "config.ts");
  if (!existsSync(worldPath) || !existsSync(configPath)) {
    throw new Error(`\u4E0A\u6E38\u6E90\u7801\u4E0D\u5B8C\u6574\uFF1A\u627E\u4E0D\u5230 ${worldPath} \u6216 ${configPath}`);
  }
  const worldUrl = pathToFileURL(worldPath).href;
  const configUrl = pathToFileURL(configPath).href;
  const [world, config] = await Promise.all([import(worldUrl), import(configUrl)]);
  if (typeof world.JourneyWorld !== "function") {
    throw new Error(`\u4E0A\u6E38 ${worldPath} \u6CA1\u6709\u5BFC\u51FA JourneyWorld\uFF1B\u8BF7\u68C0\u67E5 raw \u66F4\u65B0\u3002`);
  }
  if (typeof config.JOURNEY_DEFAULTS !== "function") {
    throw new Error(`\u4E0A\u6E38 ${configPath} \u6CA1\u6709\u5BFC\u51FA JOURNEY_DEFAULTS\uFF1B\u8BF7\u68C0\u67E5 raw \u66F4\u65B0\u3002`);
  }
  return {
    JourneyWorld: world.JourneyWorld,
    JOURNEY_DEFAULTS: config.JOURNEY_DEFAULTS,
    JOURNEY_ID: typeof config.JOURNEY_ID === "string" ? config.JOURNEY_ID : "journey"
  };
}

// adapter/config.ts
import { existsSync as existsSync2, readFileSync, statSync } from "node:fs";
import { dirname as dirname2, join as join2 } from "node:path";
function configPathFor(dataDir) {
  return join2(dataDir, "engine-config.json");
}
function loadEngineConfig(dataDir, path = configPathFor(dataDir), defaults) {
  const notes = [];
  if (!existsSync2(path)) {
    return { cfg: { ...defaults }, offline: false, path, notes };
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  } catch (e) {
    notes.push(`engine-config.json \u8BFB\u4E0D\u51FA\u6765\uFF0C\u5148\u7528 raw \u9ED8\u8BA4\u503C\uFF08\u539F\u6587\u4EF6\u6CA1\u52A8\uFF09\uFF1A${e instanceof Error ? e.message : String(e)}`);
    return { cfg: { ...defaults }, offline: false, path, notes };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    notes.push("engine-config.json \u4E0D\u662F\u5BF9\u8C61\uFF0C\u5148\u7528 raw \u9ED8\u8BA4\u503C\u3002");
    return { cfg: { ...defaults }, offline: false, path, notes };
  }
  const o = raw;
  const section = o.engine && typeof o.engine === "object" && !Array.isArray(o.engine) ? o.engine : o;
  const cfg = { ...defaults, ...section };
  const wrapper = o.wrapper && typeof o.wrapper === "object" && !Array.isArray(o.wrapper) ? o.wrapper : {};
  return {
    cfg,
    offline: wrapper.offline === true,
    path,
    notes
  };
}
function applyEngineConfig(cfg, next, defaults) {
  for (const key of Object.keys(cfg)) {
    if (!(key in next)) cfg[key] = defaults[key];
  }
  Object.assign(cfg, next);
}
var ConfigWatcher = class {
  constructor(path, defaults) {
    this.path = path;
    this.defaults = defaults;
    this.mtime = mtimeOf(path);
  }
  path;
  defaults;
  mtime = 0;
  read() {
    const m = mtimeOf(this.path);
    if (m === this.mtime) return null;
    this.mtime = m;
    return loadEngineConfig(dirname2(this.path), this.path, this.defaults);
  }
};
function mtimeOf(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

// adapter/contract.ts
import { existsSync as existsSync3, readFileSync as readFileSync2 } from "node:fs";
import { dirname as dirname3, join as join3 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
var REQUIRED_TOOL_NAMES = [
  "journey_now",
  "journey_diary_write",
  "journey_diary_read",
  "journey_stats",
  "journey_draw_to"
];
var REQUIRED_PROMPT_VARS = [
  "journey.version",
  "journey.status",
  "journey.now",
  "journey.withUser",
  "journey.beatGap",
  "journey.home",
  "journey.homeFeel",
  "journey.diary"
];
function assertRawWorldShape(world) {
  if (!world || typeof world !== "object") throw new Error("raw JourneyWorld \u6CA1\u6709\u6784\u9020\u51FA\u6765");
  const w = world;
  for (const name of ["start", "stop", "tools", "envPromptVars", "webUi"]) {
    if (typeof w[name] !== "function") {
      throw new Error(`\u4E0A\u6E38 JourneyWorld.${name} \u4E0D\u89C1\u4E86\uFF1B\u8BF7\u68C0\u67E5 raw \u66F4\u65B0\u5E76\u8C03\u6574 adapter/raw.ts\u3002`);
    }
  }
}
function assertWebUiShape(ui) {
  if (!ui || typeof ui.invoke !== "function") {
    throw new Error("\u4E0A\u6E38 webUi().invoke \u4E0D\u89C1\u4E86\uFF1B\u9762\u677F\u6865\u63A5\u9700\u8981\u66F4\u65B0 adapter/bridge.ts\u3002");
  }
  const ids = new Set((ui.panels ?? []).map((p) => p?.id).filter(Boolean));
  for (const id of ["now", "album"]) {
    if (!ids.has(id)) throw new Error(`\u4E0A\u6E38 webUi().panels \u7F3A\u5C11\u300C${id}\u300D\u9875\uFF1B\u8BF7\u8C03\u6574 adapter/bridge.ts\u3002`);
  }
}
function assertToolNames(tools) {
  const names = new Set(tools.map((t) => t.name));
  const missing = REQUIRED_TOOL_NAMES.filter((n) => !names.has(n));
  if (missing.length) {
    throw new Error(`\u4E0A\u6E38\u5DE5\u5177\u7F3A\u5C11\uFF1A${missing.join("\u3001")}\uFF1B\u8BF7\u68C0\u67E5 raw/src/world.ts \u7684 TOOL_DECLS\u3002`);
  }
}
function assertPromptVars(vars) {
  const missing = REQUIRED_PROMPT_VARS.filter((n) => typeof vars[n] !== "string");
  if (missing.length) {
    throw new Error(`\u4E0A\u6E38 envPromptVars \u7F3A\u5C11\uFF1A${missing.join("\u3001")}\uFF1B\u63D0\u793A\u8BCD\u6E32\u67D3\u4F1A\u5931\u8D25\u3002`);
  }
}
function readUpstreamInfo(root = process.env.JOURNEY_RAW_DIR || join3(process.cwd(), "raw")) {
  try {
    const pkg = JSON.parse(readFileSync2(join3(root, "package.json"), "utf8"));
    if (typeof pkg.version === "string") return { version: pkg.version };
  } catch {
  }
  const here = dirname3(fileURLToPath2(import.meta.url));
  const candidates = [
    join3(here, "upstream.json"),
    join3(here, "..", "upstream.json"),
    join3(process.cwd(), "plugin", "astrbot_plugin_world_journey", "engine", "upstream.json")
  ];
  for (const path of candidates) {
    try {
      if (!existsSync3(path)) continue;
      const raw = JSON.parse(readFileSync2(path, "utf8"));
      if (typeof raw.version === "string") return { version: raw.version, sha256: raw.sha256, builtAt: raw.builtAt };
    } catch {
    }
  }
  return { version: "unknown" };
}

// adapter/events.ts
import { appendFileSync, existsSync as existsSync4, mkdirSync, readFileSync as readFileSync3, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join as join4 } from "node:path";
var MEMORY_LIMIT = 1e3;
var EventLog = class {
  file;
  metaFile;
  eventLogId;
  items = [];
  nextSeq = 1;
  constructor(dataDir) {
    this.file = join4(dataDir, "events.jsonl");
    this.metaFile = join4(dataDir, "events.meta.json");
    this.eventLogId = this.loadOrCreateId();
    this.loadTail();
  }
  get lastSeq() {
    return this.nextSeq - 1;
  }
  append(event) {
    const stored = { ...event, seq: this.nextSeq++ };
    try {
      mkdirSync(join4(this.file, ".."), { recursive: true });
      appendFileSync(this.file, `${JSON.stringify(stored)}
`, "utf8");
    } catch {
    }
    this.items.push(stored);
    if (this.items.length > MEMORY_LIMIT) this.items = this.items.slice(-MEMORY_LIMIT);
    return stored;
  }
  /** `after=0` 时给最近一批；否则给游标之后。 */
  after(seq, limit = 200) {
    if (seq <= 0) return this.items.slice(-Math.max(0, limit));
    return this.items.filter((e) => e.seq > seq).slice(0, limit);
  }
  recent(n = 50) {
    return this.items.slice(-Math.max(0, n));
  }
  loadOrCreateId() {
    try {
      if (existsSync4(this.metaFile)) {
        const raw = JSON.parse(readFileSync3(this.metaFile, "utf8"));
        if (typeof raw.eventLogId === "string" && raw.eventLogId) return raw.eventLogId;
      }
    } catch {
    }
    const id = randomUUID();
    try {
      mkdirSync(join4(this.metaFile, ".."), { recursive: true });
      writeFileSync(this.metaFile, JSON.stringify({ eventLogId: id }, null, 2), "utf8");
    } catch {
    }
    return id;
  }
  loadTail() {
    if (!existsSync4(this.file)) return;
    let text3;
    try {
      text3 = readFileSync3(this.file, "utf8");
    } catch {
      return;
    }
    const lines = text3.split("\n").filter((line) => line.trim()).slice(-MEMORY_LIMIT);
    for (const line of lines) {
      try {
        const raw = JSON.parse(line);
        if (typeof raw.seq !== "number" || typeof raw.type !== "string" || typeof raw.text !== "string") continue;
        this.items.push(raw);
      } catch {
      }
    }
    this.nextSeq = this.items.reduce((m, e) => Math.max(m, e.seq), 0) + 1;
  }
};

// adapter/host.ts
import { appendFileSync as appendFileSync2, mkdirSync as mkdirSync2 } from "node:fs";
import { join as join5 } from "node:path";
var SILENT_LOGGER = {
  info: () => {
  },
  warn: () => {
  },
  error: () => {
  },
  debug: () => {
  }
};
function createLogger(dataDir, opts = {}) {
  const echo = opts.echo ?? true;
  const verbose = opts.verbose ?? false;
  const file = join5(dataDir, "logs", "sidecar.log");
  let ready = false;
  const write = (level, msg) => {
    const line = `${(/* @__PURE__ */ new Date()).toISOString()} [${level}] ${msg}`;
    if (echo) {
      if (level === "ERROR") console.error(line);
      else if (level === "WARN") console.warn(line);
      else console.log(line);
    }
    try {
      if (!ready) {
        mkdirSync2(join5(dataDir, "logs"), { recursive: true });
        ready = true;
      }
      appendFileSync2(file, `${line}
`, "utf8");
    } catch {
    }
  };
  return {
    info: (msg) => write("INFO", msg),
    warn: (msg) => write("WARN", msg),
    error: (msg) => write("ERROR", msg),
    debug: (msg) => {
      if (verbose) write("DEBUG", msg);
    }
  };
}
var RawHost = class {
  log;
  events;
  media;
  onEvent;
  constructor(opts) {
    this.events = opts.events;
    this.media = opts.media;
    this.onEvent = opts.onEvent ?? null;
    this.log = createLogger(opts.dataDir, { echo: opts.echo ?? true, verbose: opts.verbose ?? false });
  }
  async pushEvent(event, opts) {
    const blobs = Array.isArray(event.blobs) ? event.blobs : [];
    const refs = [];
    for (const blob of blobs) {
      if (!blob?.bytes) continue;
      const ref = this.media.save({
        bytes: blob.bytes,
        mime: typeof blob.mime === "string" && blob.mime ? blob.mime : "image/png",
        name: typeof blob.name === "string" && blob.name ? blob.name : "photo.png"
      });
      refs.push(ref);
    }
    const type = typeof event.type === "string" && event.type ? event.type : "journey.unknown";
    const key = typeof event.senderKey === "string" && event.senderKey ? event.senderKey : `${type}-${Date.now().toString(36)}`;
    const stored = this.events.append({
      type,
      key,
      text: typeof event.text === "string" ? event.text : "",
      trigger: opts?.trigger === "debounce" ? "debounce" : "flush",
      ts: typeof event.ts === "string" ? event.ts : (/* @__PURE__ */ new Date()).toISOString(),
      ...refs[0] ? { photo: refs[0] } : {}
    });
    this.onEvent?.(stored);
    return refs.length ? { blobs: refs.map((r) => ({ handle: r.handle })) } : {};
  }
};
function withHostFallback(host) {
  return new Proxy(host, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      if (typeof prop === "symbol") return void 0;
      target.log.warn(`\u4E0A\u6E38\u8C03\u7528\u4E86\u672A\u5B9E\u73B0\u7684 host.${String(prop)}\uFF0C\u5DF2\u7528 no-op \u515C\u5E95\uFF1B\u53EF\u80FD\u9700\u8981\u66F4\u65B0 adapter/host.ts\u3002`);
      return () => void 0;
    }
  });
}

// adapter/media.ts
import { createHash } from "node:crypto";
import { existsSync as existsSync5, mkdirSync as mkdirSync3, readFileSync as readFileSync4, writeFileSync as writeFileSync2 } from "node:fs";
import { basename, extname, join as join6 } from "node:path";
var MIME_EXT = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif"
};
var EXT_MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif"
};
var SAFE_NAME = /^[A-Za-z0-9._-]+$/;
var LocalMediaStore = class {
  dir;
  constructor(dataDir) {
    this.dir = join6(dataDir, "media");
  }
  /** 保存一张图；同内容只存一份。返回媒体文件名。 */
  save(input) {
    mkdirSync3(this.dir, { recursive: true });
    const hash = createHash("sha1").update(input.bytes).digest("hex").slice(0, 16);
    const ext = MIME_EXT[input.mime.toLowerCase()] ?? safeExt(input.name) ?? ".png";
    const file = `${hash}${ext}`;
    const path = join6(this.dir, file);
    if (!existsSync5(path)) writeFileSync2(path, input.bytes);
    return { handle: file, file };
  }
  /** 外部文件名 → 安全路径；只接受 basename，拒绝目录穿越。 */
  pathOf(file) {
    let decoded;
    try {
      decoded = decodeURIComponent(file);
    } catch {
      return null;
    }
    const name = basename(decoded);
    if (!name || name !== decoded || !SAFE_NAME.test(name) || name.startsWith(".")) return null;
    const path = join6(this.dir, name);
    return existsSync5(path) ? path : null;
  }
  read(file) {
    const path = this.pathOf(file);
    if (!path) return null;
    try {
      return readFileSync4(path);
    } catch {
      return null;
    }
  }
  mimeOf(file) {
    return EXT_MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
  }
};
function safeExt(name) {
  const ext = extname(name).toLowerCase();
  return /^\.[a-z0-9]{2,5}$/.test(ext) ? ext : null;
}

// adapter/prompt.ts
import { existsSync as existsSync6, readFileSync as readFileSync5 } from "node:fs";
import { fileURLToPath as fileURLToPath3 } from "node:url";
import { dirname as dirname4, join as join7 } from "node:path";
var ACTION_HEADING = "### \u8EAB\u4F53\u600E\u4E48\u52A8";
var CHAT_FOOTER = [
  "",
  "### \u804A\u5929\u5E73\u53F0",
  "",
  "\u4F60\u5728\u804A\u5929\u5E73\u53F0\u91CC\uFF0C\u6CA1\u6709\u7ACB\u7ED8\u3001\u6CA1\u6709\u52A8\u4F5C\u8BCD\u8868\u3002\u4E0D\u8981\u8F93\u51FA\u3010\u52A8\u4F5C\u3011\u5F62\u5F0F\u7684\u6807\u8BB0\uFF0C",
  "\u4E5F\u4E0D\u8981\u7528\u62EC\u53F7\u5199\u52A8\u4F5C\uFF1B\u53EA\u7528\u6587\u5B57\u8BF4\u8BDD\u3002",
  ""
].join("\n");
function findPromptFile(explicit) {
  const here = dirname4(fileURLToPath3(import.meta.url));
  const rawEnv = process.env.JOURNEY_RAW_DIR?.trim();
  const candidates = [
    explicit,
    rawEnv ? join7(rawEnv, "ENV_PROMPT.md") : void 0,
    join7(here, "..", "raw", "ENV_PROMPT.md"),
    join7(here, "..", "ENV_PROMPT.md"),
    join7(process.cwd(), "raw", "ENV_PROMPT.md"),
    join7(process.cwd(), "plugin", "astrbot_plugin_world_journey", "raw", "ENV_PROMPT.md"),
    join7(process.cwd(), "plugin", "astrbot_plugin_world_journey", "ENV_PROMPT.md"),
    join7(process.cwd(), "ENV_PROMPT.md")
  ].filter((p) => typeof p === "string" && p.length > 0);
  for (const path of candidates) {
    if (existsSync6(path)) return path;
  }
  throw new Error(`\u627E\u4E0D\u5230 ENV_PROMPT.md\uFF08\u8BD5\u8FC7\uFF1A${candidates.join("\u3001")}\uFF09`);
}
function readPromptFile(explicit) {
  const path = findPromptFile(explicit);
  const text3 = readFileSync5(path, "utf8");
  return { text: text3, path, hadActionSection: text3.includes(ACTION_HEADING) };
}
function stripActionSection(template) {
  const index = template.indexOf(ACTION_HEADING);
  const base = index >= 0 ? template.slice(0, index).replace(/\s+$/, "") : template.replace(/\s+$/, "");
  return {
    text: `${base}
${CHAT_FOOTER}`,
    stripped: index >= 0
  };
}
function sanitizePlatformText(text3) {
  return text3.replace(/（装了一起听歌可用\s*music_pick）/g, "").replace(/music_pick/g, "").replace(/[ \t]+\n/g, "\n");
}
var VAR_RE = /\{\{\s*([\w.]+)\s*\}\}/g;
function buildPrompt(vars, promptPath) {
  const file = readPromptFile(promptPath);
  const stripped = stripActionSection(file.text);
  const warnings = [];
  if (!stripped.stripped) {
    warnings.push("\u4E0A\u6E38 ENV_PROMPT.md \u91CC\u6CA1\u627E\u5230\u300C### \u8EAB\u4F53\u600E\u4E48\u52A8\u300D\uFF0C\u52A8\u4F5C\u6BB5\u53EF\u80FD\u6539\u540D\u4E86\uFF1B\u8BF7\u68C0\u67E5 adapter/prompt.ts\u3002");
  }
  const missing = /* @__PURE__ */ new Set();
  const text3 = stripped.text.replace(VAR_RE, (whole, name) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name] ?? "";
    missing.add(name);
    return whole;
  });
  return {
    text: sanitizePlatformText(text3),
    missing: [...missing],
    path: file.path,
    warnings
  };
}

// adapter/selfie.ts
import { readFile } from "node:fs/promises";
import { extname as extname2 } from "node:path";
var DEFAULT_PROMPT = [
  "\u4E00\u5F20\u81EA\u62CD\u7167\u7247\uFF1A{subject}\u5728\u753B\u9762\u91CC\uFF0C\u624B\u673A\u524D\u7F6E\u955C\u5934\u8FD1\u8DDD\u79BB\u81EA\u62CD\uFF0C\u8138\u548C\u4E0A\u534A\u8EAB\u6E05\u6670\uFF0C\u773C\u775B\u770B\u7740\u955C\u5934\uFF0C\u8868\u60C5\u81EA\u7136\u3002",
  "\u753B\u98CE\uFF1A{style}",
  "\u65F6\u95F4\uFF1A{time}\uFF08{clock}\uFF09\u3002",
  "\u80CC\u666F\uFF1A{scene}",
  "\u53C2\u8003\u56FE\u662F{subject}\u7684\u957F\u76F8\u53C2\u8003\uFF1A\u4FDD\u6301\u4E94\u5B98\u3001\u8138\u578B\u3001\u53D1\u578B\u3001\u80A4\u8272\u3001\u5E74\u9F84\u548C\u6C14\u8D28\u4E00\u81F4\uFF1B\u4E0D\u8981\u6362\u8138\uFF0C\u4E0D\u8981\u53D8\u6210\u964C\u751F\u4EBA\uFF0C\u4E0D\u8981\u7167\u642C\u53C2\u8003\u56FE\u7684\u80CC\u666F\u548C\u8863\u670D\uFF1B\u6309\u4E0A\u9762\u7684\u753B\u98CE\u7ED8\u5236\uFF0C\u4E0D\u8981\u81EA\u884C\u6539\u6210\u771F\u4EBA\u7167\u7247\u3002",
  "\u753B\u9762\u91CC\u53EA\u6709{subject}\u4E00\u4E2A\u4EBA\uFF0C\u6CA1\u6709\u6587\u5B57\u3001\u6C34\u5370\u3001\u8FB9\u6846\u3002"
].join("\n");
var DEFAULT_SCENE_PROMPT = [
  "\u753B\u98CE\uFF1A{style}",
  "{scene}",
  "\u65F6\u95F4\uFF1A{time}\uFF08{clock}\uFF09\u3002",
  "\u753B\u9762\u91CC\u6CA1\u6709\u4EBA\u7269\uFF0C\u6CA1\u6709\u6587\u5B57\uFF0C\u6CA1\u6709\u6C34\u5370\uFF0C\u6CA1\u6709\u8FB9\u6846\u3002"
].join("\n");
var EMPTY_STYLE_LINE = /^[^：:\n]*：\s*$/;
function normalizeStyle(style) {
  const raw = (style ?? "").trim();
  return raw.toLowerCase() === "none" ? "" : raw;
}
var NO_PEOPLE = /画面里没有人物[^。]*。/g;
var PASSERBY = /视角像路过的人[^。]*。/g;
var FILM = /胶片质感[^。]*。/g;
var TIME_OF_DAY = [
  [0, "\u5348\u591C"],
  [90, "\u51CC\u6668"],
  [210, "\u9ECE\u660E\u524D"],
  [270, "\u62C2\u6653"],
  [300, "\u9ECE\u660E"],
  [315, "\u7834\u6653"],
  [360, "\u6668\u5149\u521D\u73B0"],
  [405, "\u6E05\u6668"],
  [450, "\u65E9\u6668"],
  [510, "\u4E0A\u5348"],
  [600, "\u4E0A\u5348\u5C06\u5C3D"],
  [660, "\u4E34\u8FD1\u6B63\u5348"],
  [690, "\u6B63\u5348"],
  [780, "\u5348\u540E"],
  [840, "\u4E0B\u5348"],
  [930, "\u4E0B\u5348\u5C06\u5C3D"],
  [990, "\u508D\u665A"],
  [1050, "\u9EC4\u660F"],
  [1095, "\u66AE\u8272"],
  [1140, "\u5165\u591C"],
  [1200, "\u591C\u665A"],
  [1320, "\u6DF1\u591C"],
  [1410, "\u5348\u591C\u524D"]
];
function pad2(value) {
  return String(value).padStart(2, "0");
}
function parseClock(value) {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec((value ?? "").trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  const second = m[3] ? Number(m[3]) : 0;
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { minutes: hour * 60 + minute, text: `${pad2(hour)}:${pad2(minute)}` };
}
function systemClock() {
  const now = /* @__PURE__ */ new Date();
  return {
    minutes: now.getHours() * 60 + now.getMinutes(),
    text: `${pad2(now.getHours())}:${pad2(now.getMinutes())}`
  };
}
function labelFor(minutes) {
  let label = TIME_OF_DAY[0][1];
  for (const [start, text3] of TIME_OF_DAY) {
    if (minutes >= start) label = text3;
    else break;
  }
  return label;
}
function describeTime(clock) {
  const parsed = parseClock(clock) ?? systemClock();
  return { label: labelFor(parsed.minutes), clock: parsed.text };
}
function renderImagePrompt(original, opts, clock) {
  const style = normalizeStyle(opts.style);
  const lead = style ? `${style}\uFF1A` : "";
  const scene = original.replace(/^一张真实旅行照片：/, "").replace(NO_PEOPLE, "").replace(PASSERBY, "").replace(FILM, "").replace(/\s+/g, " ").trim().replace(new RegExp(`^${escapePattern(lead)}`), "");
  const subject = opts.subject.trim() || "\u5979\u672C\u4EBA";
  const template = opts.promptTemplate.trim() || DEFAULT_PROMPT;
  const time = describeTime(clock);
  const hasStyle = template.includes("{style}");
  const styled = template.split("\n").map((line) => line.includes("{style}") ? line.replaceAll("{style}", style) : line).filter((line) => !(style === "" && EMPTY_STYLE_LINE.test(line.trim()))).join("\n");
  let prompt = styled.replaceAll("{scene}", scene).replaceAll("{subject}", subject).replaceAll("{time}", time.label).replaceAll("{clock}", time.clock);
  if (!template.includes("{time}") && !template.includes("{clock}")) {
    prompt += `
\u65F6\u95F4\uFF1A${time.label}\uFF08${time.clock}\uFF09\u3002`;
  }
  if (style && !hasStyle) {
    prompt += `
\u753B\u98CE\uFF1A${style}`;
  }
  return prompt.trim();
}
var DEFAULT_SCENE_TEMPLATE = DEFAULT_SCENE_PROMPT;
function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function installPhotoProxy(opts, log, fetchImpl = globalThis.fetch) {
  const models = modelListOf(opts.models);
  const selfie = opts.selfie?.enabled === true ? opts.selfie : null;
  const scene = opts.scene && opts.scene.enabled === true && opts.scene.promptTemplate.trim() ? opts.scene : null;
  if (!selfie && !scene && models.length < 2) return { uninstall: () => {
  }, fetch: fetchImpl };
  if (selfie && selfie.references.length === 0) {
    log.warn("\u81EA\u62CD\u5DF2\u5F00\u542F\uFF0C\u4F46\u6CA1\u6709\u53C2\u8003\u56FE\uFF1B\u7167\u7247\u4F1A\u5931\u8D25\u800C\u4E0D\u662F\u9000\u56DE\u7A7A\u955C\u3002\u8BF7\u5728\u63D2\u4EF6\u914D\u7F6E\u91CC\u4E0A\u4F20 selfie_reference\u3002");
  }
  const original = fetchImpl;
  const wrapper = async (input, init) => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : String(input);
    if (!isGenerationRequest(url, init)) return original(input, init);
    const body = parseJsonBody(init?.body);
    const prompt = typeof body?.prompt === "string" ? body.prompt : "";
    if (!body || !prompt) return original(input, init);
    const selfieModels = selfie ? modelListOf(selfie.model) : [];
    const fallbackModel = stringOf(body.model).trim() || "gpt-image-1";
    const candidates = selfie ? selfieModels.length ? selfieModels : [fallbackModel] : models.length ? models : [fallbackModel];
    let reference = null;
    let clock;
    if (selfie || scene) {
      if (selfie) {
        try {
          reference = await loadSelfieReference(selfie, original);
        } catch (e) {
          const message2 = errText(e);
          log.warn(`\u81EA\u62CD\u751F\u56FE\u5931\u8D25\uFF1A${message2}`);
          return jsonResponse({ error: { message: message2 } }, 502);
        }
      }
      try {
        clock = await opts.clock?.() ?? void 0;
      } catch {
        clock = void 0;
      }
    }
    const scenePrompt = scene ? renderImagePrompt(prompt, {
      subject: scene.subject ?? "",
      promptTemplate: scene.promptTemplate,
      style: scene.style
    }, clock) : prompt;
    if (scene && !selfie) logPrompt(log, "scene", scenePrompt);
    const failures = [];
    for (const model of candidates) {
      try {
        if (selfie) {
          const result = await generateSelfieWithModel(selfie, model, body, prompt, original, log, reference, clock);
          return jsonResponse({ data: [result] });
        }
        const res = await replayWithModel(
          original,
          url,
          init ?? {},
          scene ? { ...body, prompt: scenePrompt } : body,
          model
        );
        if (res.ok) return res;
        const detail = await peekError(res);
        if (shouldKeepResponse(res.status, detail)) return res;
        failures.push(`${model}\uFF1AHTTP ${res.status}${detail ? `\uFF1A${detail}` : ""}`);
      } catch (e) {
        const why = errText(e);
        failures.push(`${model}\uFF1A${why}`);
        if (!selfie) throw e;
      }
    }
    const message = candidates.length > 1 ? `\u6240\u6709\u751F\u56FE\u6A21\u578B\u90FD\u5931\u8D25\u4E86\uFF08${failures.join("\uFF1B")}\uFF09` : failures[0] ?? "\u751F\u56FE\u5931\u8D25";
    log.warn(`\u751F\u56FE\u5931\u8D25\uFF1A${message}`);
    return jsonResponse({ error: { message } }, 502);
  };
  globalThis.fetch = wrapper;
  return {
    fetch: original,
    uninstall: () => {
      if (globalThis.fetch === wrapper) globalThis.fetch = original;
    }
  };
}
async function generateSelfieBytes(prompt, opts, fetchImpl = globalThis.fetch, log = { info: () => {
}, warn: () => {
} }, clock) {
  const reference = await loadSelfieReference(opts, fetchImpl);
  const models = modelListOf(opts.model);
  const candidates = models.length ? models : ["gpt-image-1"];
  const failures = [];
  let result = null;
  for (const model of candidates) {
    try {
      result = await generateSelfieWithModel(opts, model, {}, prompt, fetchImpl, log, reference, clock);
      break;
    } catch (e) {
      const why = errText(e);
      failures.push(candidates.length > 1 ? `${model}\uFF1A${why}` : why);
      log.warn(`\u81EA\u62CD\u6A21\u578B ${model} \u5931\u8D25\uFF1A${why}`);
    }
  }
  if (!result) {
    throw new Error(candidates.length > 1 ? `\u81EA\u62CD\u6240\u6709\u6A21\u578B\u90FD\u5931\u8D25\u4E86\uFF08${failures.join("\uFF1B")}\uFF09` : failures[0] ?? "\u81EA\u62CD\u5931\u8D25");
  }
  if (result.b64_json) {
    const bytes = new Uint8Array(Buffer.from(result.b64_json, "base64"));
    const mime = sniffImage(bytes);
    if (!mime) throw new Error("\u81EA\u62CD b64 \u89E3\u51FA\u6765\u4E0D\u662F\u56FE\u7247");
    return { bytes, mime };
  }
  if (result.url) {
    const res = await fetchImpl(result.url, { signal: AbortSignal.timeout(12e4) });
    if (!res.ok) throw new Error(`\u4E0B\u8F7D\u81EA\u62CD\u56FE HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const mime = sniffImage(bytes) ?? res.headers.get("content-type")?.split(";")[0]?.trim() ?? "image/png";
    return { bytes, mime };
  }
  throw new Error("\u81EA\u62CD\u63A5\u53E3\u6CA1\u6709\u8FD4\u56DE\u56FE\u7247");
}
async function generateSelfieWithModel(opts, model, upstreamBody, originalPrompt, fetchImpl, log, reference, clock) {
  const api = opts.api.trim().replace(/\/+$/, "");
  if (!api) throw new Error("\u81EA\u62CD\u751F\u56FE\u63A5\u53E3\u6CA1\u586B\uFF08selfie_api / image_api\uFF09");
  const prompt = renderImagePrompt(originalPrompt, opts, clock);
  logPrompt(log, `selfie-${opts.mode}`, prompt);
  const size = opts.size.trim() || stringOf(upstreamBody.size) || "1024x1024";
  const headers = {};
  if (opts.key.trim()) headers.authorization = `Bearer ${opts.key.trim()}`;
  if (opts.mode === "native") {
    return await generateNative(opts, api, model, size, prompt, reference, headers, fetchImpl, log);
  }
  if (opts.mode === "generation") {
    const dataUrl = `data:${reference.mime};base64,${Buffer.from(reference.bytes).toString("base64")}`;
    const payload = {
      model,
      prompt,
      n: 1,
      size,
      response_format: "b64_json",
      [opts.imageField.trim() || "image_url"]: opts.imageField.trim() === "image" ? Buffer.from(reference.bytes).toString("base64") : dataUrl
    };
    const res2 = await postJson(`${api}/images/generations`, headers, payload, fetchImpl);
    log.info(`\u81EA\u62CD\u63A5\u53E3\u54CD\u5E94\uFF1AHTTP ${res2.status}\uFF08generation\uFF09\uFF0Ccontent-length=${res2.headers.get("content-length") ?? "?"}`);
    const image2 = parseImagePayload(await readJson(res2, log));
    logSelfieImage(image2, log);
    return image2;
  }
  const form = new FormData();
  form.set("model", model);
  form.set("prompt", prompt);
  form.set("n", "1");
  form.set("size", size);
  form.set("response_format", "b64_json");
  form.set("image", new Blob([reference.bytes], { type: reference.mime }), reference.name);
  let res = await fetchImpl(`${api}/images/edits`, { method: "POST", headers, body: form });
  if (res.status === 400 || res.status === 415) {
    const peek = (await res.clone().text()).slice(0, 500);
    if (/multipart|content-type|image|图片/i.test(peek)) {
      const dataUrl = `data:${reference.mime};base64,${Buffer.from(reference.bytes).toString("base64")}`;
      res = await postJson(`${api}/images/edits`, headers, {
        model,
        prompt,
        n: 1,
        size,
        response_format: "b64_json",
        image: dataUrl
      }, fetchImpl);
    }
  }
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 500);
    throw new Error(`\u81EA\u62CD\u63A5\u53E3 HTTP ${res.status}${detail ? `\uFF1A${detail}` : ""}`);
  }
  log.info(`\u81EA\u62CD\u63A5\u53E3\u54CD\u5E94\uFF1AHTTP ${res.status}\uFF08edit\uFF09\uFF0Ccontent-length=${res.headers.get("content-length") ?? "?"}`);
  const image = parseImagePayload(await readJson(res, log));
  logSelfieImage(image, log);
  return image;
}
async function loadSelfieReference(opts, fetchImpl) {
  const references = opts.references.filter(Boolean);
  if (!references.length) throw new Error("\u6CA1\u6709\u53C2\u8003\u56FE\uFF1A\u8BF7\u5728\u63D2\u4EF6\u914D\u7F6E\u91CC\u4E0A\u4F20 selfie_reference");
  return loadReference(references[0], fetchImpl);
}
function replayWithModel(original, url, init, body, model) {
  const headers = new Headers(init.headers ?? {});
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return original(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...body, model }),
    signal: init.signal ?? void 0
  });
}
function shouldKeepResponse(status, detail) {
  if (status === 401 || status === 403) return true;
  if (status === 400 && /image_size|response_format|watermark|水印|尺寸|分辨率|\bsize\b/i.test(detail)) {
    return true;
  }
  return false;
}
async function peekError(res) {
  try {
    const text3 = (await res.clone().text()).slice(0, 500);
    try {
      const o = JSON.parse(text3);
      const msg = typeof o.error === "object" && o.error ? o.error.message : o.message ?? o.error;
      if (typeof msg === "string" && msg.trim()) return msg.trim().slice(0, 200);
    } catch {
    }
    return text3.replace(/\s+/g, " ").trim().slice(0, 200);
  } catch {
    return "";
  }
}
function errText(e) {
  return e instanceof Error ? e.message : String(e);
}
function modelListOf(value) {
  const raw = typeof value === "string" ? value.split(/[\n,，;；]+/) : Array.isArray(value) ? value : [];
  const out = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}
async function generateNative(opts, api, model, size, prompt, reference, headers, fetchImpl, log) {
  const nativeUrl = (opts.nativeUrl ?? "").trim() || `${new URL(api).origin}/api/v1/services/aigc/multimodal-generation/generation`;
  const dataUrl = `data:${reference.mime};base64,${Buffer.from(reference.bytes).toString("base64")}`;
  const payload = {
    model,
    input: {
      messages: [{
        role: "user",
        content: [{ image: dataUrl }, { text: prompt }]
      }]
    },
    parameters: {
      size: nativeSize(size),
      n: 1,
      watermark: false,
      thinking_mode: false
    }
  };
  const res = await postJson(nativeUrl, headers, payload, fetchImpl);
  log.info(`\u81EA\u62CD\u63A5\u53E3\u54CD\u5E94\uFF1AHTTP ${res.status}\uFF08native\uFF09\uFF0Ccontent-length=${res.headers.get("content-length") ?? "?"}`);
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 500);
    throw new Error(`\u81EA\u62CD\u63A5\u53E3 HTTP ${res.status}${detail ? `\uFF1A${detail}` : ""}`);
  }
  const parsed = await readJson(res, log);
  const image = extractNativeImage(parsed);
  logSelfieImage(image, log);
  return image;
}
function nativeSize(size) {
  const value = size.trim();
  if (!value) return "1K";
  if (value === "1024x1024") return "1K";
  if (value === "2048x2048") return "2K";
  return value;
}
function extractNativeImage(payload) {
  const root = payload;
  const content = root.output?.choices?.[0]?.message?.content;
  if (Array.isArray(content)) {
    for (const item of content) {
      const image = item?.image;
      if (typeof image !== "string" || !image) continue;
      if (image.startsWith("data:")) return { b64_json: image.slice(image.indexOf(",") + 1) };
      if (/^https?:\/\//i.test(image)) return { url: image };
      return { b64_json: image };
    }
  }
  throw new Error("\u4E07\u76F8\u539F\u751F\u63A5\u53E3\u8FD4\u56DE\u91CC\u6CA1\u6709\u56FE\u7247");
}
function isGenerationRequest(url, init) {
  if ((init?.method ?? "GET").toUpperCase() !== "POST") return false;
  try {
    return new URL(url).pathname.replace(/\/+$/, "").endsWith("/images/generations");
  } catch {
    return url.replace(/\/+$/, "").endsWith("/images/generations");
  }
}
function parseJsonBody(body) {
  if (typeof body !== "string") return null;
  try {
    const value = JSON.parse(body);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
async function loadReference(ref, fetchImpl) {
  let bytes;
  let mime = "";
  let name = "reference";
  if (/^https?:\/\//i.test(ref)) {
    const res = await fetchImpl(ref, { signal: AbortSignal.timeout(3e4) });
    if (!res.ok) throw new Error(`\u53C2\u8003\u56FE\u4E0B\u8F7D\u5931\u8D25 HTTP ${res.status}`);
    bytes = new Uint8Array(await res.arrayBuffer());
    mime = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    name = lastPathName(ref) || "reference";
  } else if (ref.startsWith("data:")) {
    const m = /^data:([^;,]+);base64,(.*)$/s.exec(ref);
    if (!m) throw new Error("\u53C2\u8003\u56FE data URL \u683C\u5F0F\u4E0D\u5BF9");
    mime = m[1];
    bytes = new Uint8Array(Buffer.from(m[2], "base64"));
    name = "reference";
  } else {
    bytes = new Uint8Array(await readFile(ref));
    name = lastPathName(ref) || "reference";
  }
  if (!bytes.length) throw new Error("\u53C2\u8003\u56FE\u662F\u7A7A\u7684");
  mime = sniffImage(bytes) ?? (mime.startsWith("image/") ? mime : "image/png");
  const ext = extname2(name).toLowerCase();
  if (!ext || !/^\.(png|jpe?g|webp|gif)$/.test(ext)) name = `reference.${extFor(mime)}`;
  return { bytes, mime, name };
}
function parseImagePayload(payload) {
  const root = payload;
  const list = root?.data ?? root?.images ?? root?.output ?? root?.result;
  const first = Array.isArray(list) ? list[0] : list;
  if (typeof first === "string") {
    if (/^https?:\/\//.test(first)) return { url: first };
    return { b64_json: first };
  }
  if (first && typeof first === "object") {
    const item = first;
    for (const key of ["b64_json", "base64", "image_base64"]) {
      if (typeof item[key] === "string" && item[key]) {
        const value = item[key];
        return { b64_json: value.startsWith("data:") ? value.slice(value.indexOf(",") + 1) : value };
      }
    }
    for (const key of ["url", "image_url"]) {
      if (typeof item[key] === "string" && /^https?:\/\//.test(item[key])) return { url: item[key] };
    }
  }
  throw new Error("\u81EA\u62CD\u63A5\u53E3\u8FD4\u56DE\u91CC\u6CA1\u6709\u56FE\u7247\uFF08\u65E2\u6CA1\u6709 b64_json \u4E5F\u6CA1\u6709 url\uFF09");
}
async function postJson(url, headers, payload, fetchImpl) {
  return fetchImpl(url, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(12e4)
  });
}
async function readJson(res, log) {
  const text3 = await res.text();
  log?.info(`\u81EA\u62CD\u54CD\u5E94\u4F53\uFF1A${text3.length} \u5B57\u7B26`);
  try {
    return JSON.parse(text3);
  } catch {
    throw new Error(`\u81EA\u62CD\u63A5\u53E3\u8FD4\u56DE\u7684\u4E0D\u662F JSON\uFF08HTTP ${res.status}\uFF09\uFF1A${text3.slice(0, 200)}`);
  }
}
function logSelfieImage(image, log) {
  if (image.b64_json) {
    log.info(`\u81EA\u62CD\u56FE\uFF1Ab64_json\uFF0C${image.b64_json.length} \u5B57\u7B26`);
    return;
  }
  if (image.url) {
    let host = "?";
    try {
      host = new URL(image.url).host;
    } catch {
    }
    log.info(`\u81EA\u62CD\u56FE\uFF1Aurl\uFF0Chost=${host}`);
  }
}
function logPrompt(log, kind, prompt) {
  log.info(`\u751F\u56FE\u63D0\u793A\u8BCD\uFF08${kind}\uFF09\uFF1A${prompt.replace(/\s+/g, " ").slice(0, 400)}`);
}
function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}
function sniffImage(bytes) {
  if (bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.length >= 12 && bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70 && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80) return "image/webp";
  if (bytes.length >= 6 && bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70) return "image/gif";
  return null;
}
function extFor(mime) {
  return mime.includes("jpeg") ? "jpg" : mime.includes("webp") ? "webp" : mime.includes("gif") ? "gif" : "png";
}
function lastPathName(value) {
  try {
    return new URL(value).pathname.split("/").filter(Boolean).pop() ?? "";
  } catch {
    return value.split(/[\\/]/).filter(Boolean).pop() ?? "";
  }
}
function stringOf(value) {
  return typeof value === "string" ? value : "";
}

// adapter/photo-prompt.ts
import { existsSync as existsSync7 } from "node:fs";
import { join as join8 } from "node:path";
import { pathToFileURL as pathToFileURL2 } from "node:url";
var cached = null;
function loadPhotoHelpers(root = rawRoot()) {
  if (cached) return cached;
  cached = importPhotoHelpers(root);
  return cached;
}
async function importPhotoHelpers(root) {
  const path = join8(root, "src", "photo.ts");
  if (!existsSync7(path)) throw new Error(`\u4E0A\u6E38\u7F3A\u5C11 ${path}\uFF0C\u7528\u4E0D\u4E86\u573A\u666F\u63CF\u8FF0`);
  const mod = await import(pathToFileURL2(path).href);
  const photoPrompt = mod.photoPrompt;
  const spotFromBeat = mod.spotFromBeat;
  if (typeof photoPrompt !== "function" || typeof spotFromBeat !== "function") {
    throw new Error("\u4E0A\u6E38 photo.ts \u6CA1\u6709\u5BFC\u51FA photoPrompt/spotFromBeat\uFF1B\u8BF7\u68C0\u67E5 raw \u66F4\u65B0");
  }
  return {
    photoPrompt,
    spotFromBeat
  };
}
async function buildScenePrompt(snapshot, style) {
  const helpers = await loadPhotoHelpers();
  const hour = hourOf(snapshot.clock);
  const leg = asRecord(snapshot.leg);
  const onRoad = snapshot.mode === "traveling" && leg !== null;
  const place = asRecord(snapshot.place);
  const city = onRoad ? text(leg?.to) : text(place?.name);
  if (!city) throw new Error("\u5FEB\u7167\u91CC\u6CA1\u6709\u53EF\u7528\u7684\u57CE\u5E02\u540D");
  const spot = onRoad ? "" : spotFromTimeline(snapshot, hour, helpers.spotFromBeat);
  const weather = text(snapshot.weather);
  const feeling = text(snapshot.feeling);
  return helpers.photoPrompt({
    city,
    ...spot ? { spot } : {},
    hour,
    ...weather ? { weather } : {},
    ...feeling ? { feel: feeling } : {},
    style,
    onRoad,
    ...onRoad ? { mode: text(leg?.mode) } : {}
  }).trim();
}
function hourOf(clock) {
  const m = /^(\d{1,2}):/.exec(text(clock));
  const hour = m ? Number(m[1]) : Number.NaN;
  return Number.isFinite(hour) && hour >= 0 && hour <= 23 ? hour : 10;
}
function spotFromTimeline(snapshot, hour, spotFromBeat) {
  const items = Array.isArray(snapshot.timeline) ? snapshot.timeline : [];
  let spot = "";
  for (const item of items) {
    const row = asRecord(item);
    if (!row) continue;
    if (text(row.kind) !== "activity") continue;
    if (row.past !== true && hourOf(row.at) > hour) continue;
    const candidate = spotFromBeat(text(row.what));
    if (candidate) spot = candidate;
  }
  return spot;
}
function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

// adapter/bridge.ts
var BRIDGE_VERSION = true ? "1.0.6" : "dev";
function readLocalNowPlaying(dataDir) {
  try {
    const path = join9(dataDir, "nowplaying.json");
    if (!existsSync8(path)) return null;
    const raw = JSON.parse(readFileSync6(path, "utf8").replace(/^\uFEFF/, ""));
    const title = typeof raw.title === "string" ? raw.title.trim() : "";
    if (!title) return null;
    return {
      title,
      artist: typeof raw.artist === "string" ? raw.artist.trim() : "",
      at: Date.now()
    };
  } catch {
    return null;
  }
}
var RawBridge = class {
  dataDir;
  rawDir;
  configPath;
  promptPath;
  host;
  events;
  media;
  log;
  opts;
  raw = null;
  world = null;
  cfg = null;
  rawDefaults = null;
  watcher = null;
  uninstallSelfie = null;
  /** 装代理之前的 fetch；主动汇报自己发请求时用它，避免被自己的代理再拦一次。 */
  proxyFetch = globalThis.fetch;
  constructor(opts) {
    this.opts = opts;
    this.dataDir = opts.dataDir;
    this.rawDir = opts.rawDir ?? rawRoot();
    this.configPath = opts.configPath ?? join9(opts.dataDir, "engine-config.json");
    this.promptPath = opts.promptPath;
    this.events = new EventLog(opts.dataDir);
    this.media = new LocalMediaStore(opts.dataDir);
    this.host = opts.host ?? new RawHost({
      dataDir: opts.dataDir,
      events: this.events,
      media: this.media,
      echo: opts.echo ?? false,
      verbose: opts.verbose ?? false,
      ...opts.onEvent ? { onEvent: opts.onEvent } : {}
    });
    this.log = opts.log ?? this.host.log;
  }
  async start() {
    const raw = await loadRaw(this.rawDir);
    const defaults = raw.JOURNEY_DEFAULTS();
    const loaded = loadEngineConfig(this.dataDir, this.configPath, defaults);
    if (this.opts.initialOverrides) Object.assign(loaded.cfg, this.opts.initialOverrides);
    this.raw = raw;
    this.rawDefaults = defaults;
    this.cfg = loaded.cfg;
    this.watcher = new ConfigWatcher(this.configPath, defaults);
    for (const note of loaded.notes) this.log.warn(note);
    this.world = new raw.JourneyWorld({
      cfg: loaded.cfg,
      dataDir: this.dataDir,
      botName: "astrbot",
      ...this.opts.now ? { now: this.opts.now } : {},
      nowPlaying: this.opts.nowPlaying ?? (() => readLocalNowPlaying(this.dataDir))
    });
    assertRawWorldShape(this.world);
    await this.world.start(withHostFallback(this.host));
    const ui = this.world.webUi();
    assertWebUiShape(ui);
    assertToolNames(this.world.tools());
    assertPromptVars(this.world.envPromptVars());
    this.installSelfie();
  }
  async stop() {
    this.uninstallSelfie?.();
    this.uninstallSelfie = null;
    this.proxyFetch = globalThis.fetch;
    const world = this.world;
    this.world = null;
    this.raw = null;
    this.cfg = null;
    this.rawDefaults = null;
    this.watcher = null;
    if (world) await world.stop();
  }
  get started() {
    return this.world !== null;
  }
  /** 模拟器/诊断用。 */
  get rawWorld() {
    if (!this.world) throw new Error("raw \u8FD8\u6CA1\u542F\u52A8");
    return this.world;
  }
  get config() {
    if (!this.cfg) throw new Error("raw \u8FD8\u6CA1\u542F\u52A8\uFF0C\u914D\u7F6E\u4E0D\u53EF\u7528");
    return this.cfg;
  }
  get upstreamVersion() {
    return readUpstreamInfo(this.rawDir).version;
  }
  get bridgeVersion() {
    return BRIDGE_VERSION;
  }
  get lastSeq() {
    return this.events.lastSeq;
  }
  get eventLogId() {
    return this.events.eventLogId;
  }
  /** 文件 mtime 变了就合并进活配置；返回是否变了。 */
  reloadConfig() {
    if (!this.watcher || !this.cfg || !this.rawDefaults) return false;
    const loaded = this.watcher.read();
    if (!loaded) return false;
    applyEngineConfig(this.cfg, loaded.cfg, this.rawDefaults);
    this.installSelfie();
    for (const note of loaded.notes) this.log.info(note);
    this.log.info("\u5F15\u64CE\u914D\u7F6E\u5DF2\u70ED\u91CD\u8F7D\u3002");
    return true;
  }
  async snapshot() {
    const ui = this.ui;
    assertWebUiShape(ui);
    return await ui.invoke("now", "snapshot", []);
  }
  now() {
    const vars = this.w().envPromptVars();
    return sanitizePlatformText(String(vars["journey.now"] ?? ""));
  }
  promptVars() {
    return this.w().envPromptVars();
  }
  prompt() {
    return buildPrompt(this.promptVars(), this.promptPath ?? join9(this.rawDir, "ENV_PROMPT.md"));
  }
  tools() {
    return this.w().tools();
  }
  async callTool(name, args) {
    const tool = this.tools().find((t) => t.name === name);
    if (!tool) return { text: `\u6CA1\u6709\u8FD9\u4E2A\u5DE5\u5177\uFF1A${name}`, isError: true };
    try {
      const value = await tool.handler?.(args);
      return normalizeToolResult(value);
    } catch (e) {
      return { text: `\u5DE5\u5177 ${name} \u51FA\u9519\uFF1A${e instanceof Error ? e.message : String(e)}`, isError: true };
    }
  }
  async depart() {
    try {
      const snapshot = await this.ui.invoke("now", "depart", []);
      return { ok: true, text: this.now(), snapshot };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }
  async sync() {
    try {
      const snapshot = await this.ui.invoke("now", "syncClock", []);
      return { ok: true, text: this.now(), snapshot };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }
  /**
   * 回答「出门等点头」/「接邀约」的卡片（上游面板的两个按钮）。
   *
   * 先读快照里的 `ask`：没有在等批的事时上游会静默吞掉（`answerAsk` 直接 return），
   * 用户在聊天里得不到任何反馈 —— 这里把「她现在没在问你」变成明确的一句话。
   */
  async askAnswer(ok) {
    try {
      const snap = await this.snapshot();
      const pending = snap.ask;
      if (!pending) return { ok: false, reason: "\u5979\u73B0\u5728\u6CA1\u6709\u5728\u7B49\u4F60\u70B9\u5934\uFF08\u4E5F\u8BB8\u6CA1\u5F00\u300C\u51FA\u95E8\u7B49\u70B9\u5934\u300D\uFF0C\u4E5F\u8BB8\u5979\u8FD8\u6CA1\u95EE\uFF09\u3002" };
      const snapshot = await this.ui.invoke("now", "answerAsk", [ok]);
      const head = pending.line ? `${pending.line}
` : "";
      return { ok: true, text: ok ? `${head}\u4ED6\u70B9\u4E86\u5934\u3002${this.now()}` : `${head}\u4ED6\u7B54\u4E86\u300C\u4E0D\u597D\u300D\u3002`, snapshot };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }
  /** 叫她回来（上游面板「回来」按钮；`journey_return_home` 工具走的是同一条腿）。 */
  async returnHome() {
    try {
      const snapshot = await this.ui.invoke("now", "returnHome", []);
      return { ok: true, text: this.now(), snapshot };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }
  async photo() {
    try {
      const raw = await this.ui.invoke("album", "shoot", []);
      if (raw && raw.ok === false) return { ok: false, reason: raw.reason ?? "\u6CA1\u62CD\u6210" };
      const snapshot = await this.snapshot();
      const photo = snapshot.photos?.[0] ?? null;
      return { ok: true, text: photo ? `\u62CD\u4E86\u4E00\u5F20\uFF1A${photo.title}\u3002` : "\u62CD\u4E86\u4E00\u5F20\u3002", photo, snapshot };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }
  health() {
    return {
      ok: true,
      version: BRIDGE_VERSION,
      upstreamVersion: this.upstreamVersion,
      eventLogId: this.events.eventLogId,
      lastSeq: this.events.lastSeq,
      capabilities: this.capabilities()
    };
  }
  /** 能力实测：当前**真加载进来的 raw** 有没有这些方法/参数，如实上报给壳层。
   *
   * 壳层的指令版本闸优先信这份实测，而不是手工维护的「功能→最低版本」表 ——
   * 上游一更新这里自动跟上，忘记登记表也不会误拦（表退化为文案素材和离线兜底）。
   * world 还没起来返回空对象：壳层视作「测不到」，走版本表兜底。
   */
  capabilities() {
    const world = this.world;
    if (!world) return {};
    let answerAsk = false;
    let returnHome = false;
    let photoSubject = false;
    try {
      answerAsk = typeof world.answerAsk === "function";
      const tools = this.tools();
      const names = new Set(tools.map((t) => t.name));
      returnHome = names.has("journey_return_home");
      const photo = tools.find((t) => t.name === "journey_photo");
      const props = photo?.parameters?.properties;
      photoSubject = !!props && "subject" in props;
    } catch {
      return {};
    }
    return { answerAsk, returnHome, photoSubject };
  }
  defaultConfig() {
    if (!this.rawDefaults) throw new Error("raw \u8FD8\u6CA1\u542F\u52A8\uFF0C\u9ED8\u8BA4\u914D\u7F6E\u4E0D\u53EF\u7528");
    return this.rawDefaults;
  }
  currentConfig() {
    if (!this.cfg) throw new Error("raw \u8FD8\u6CA1\u542F\u52A8");
    return { cfg: this.cfg, offline: false, path: this.configPath, notes: [] };
  }
  get ui() {
    return this.w().webUi();
  }
  selfieOptions() {
    const cfg = this.cfg;
    if (!cfg || cfg.selfieEnabled !== true) return null;
    if (this.comfySelfieBlocked(cfg)) return null;
    const rawRefs = Array.isArray(cfg.selfieReference) ? cfg.selfieReference : typeof cfg.selfieReference === "string" ? [cfg.selfieReference] : [];
    const references = rawRefs.filter((v) => typeof v === "string" && v.trim().length > 0).map((ref) => this.resolveReference(ref.trim()));
    const modeRaw = stringOf2(cfg.selfieMode).toLowerCase();
    const selfieModel = stringOf2(cfg.selfieModel).trim();
    return {
      enabled: true,
      references,
      api: stringOf2(cfg.selfieApi) || stringOf2(cfg.imageApi),
      key: stringOf2(cfg.selfieKey) || stringOf2(cfg.imageKey),
      // 自拍模型没单独填时，用「生图模型名」的整个列表按顺序降级。
      model: selfieModel ? [selfieModel] : this.imageModels(),
      mode: modeRaw === "generation" || modeRaw === "native" ? modeRaw : "edit",
      nativeUrl: stringOf2(cfg.selfieNativeUrl),
      size: stringOf2(cfg.selfieSize),
      imageField: stringOf2(cfg.selfieImageField) || "image_url",
      subject: stringOf2(cfg.selfieSubject) || "\u5979\u672C\u4EBA",
      promptTemplate: this.selfieTemplate(cfg),
      // 画风从这条路径起也生效：模板里的 {style} 就是它。
      style: this.imageStyle()
    };
  }
  /**
   * 自拍模板的取值顺序：新字段 `imagePromptTemplate` → 旧字段 `selfiePrompt` → 空串。
   *
   * 空串交给 `selfie.ts` 回落到内置默认模板；老用户只填过 `selfie_prompt` 的，
   * 内容原样生效，不要求他重填一遍。
   */
  selfieTemplate(cfg) {
    const fresh = stringOf2(cfg.imagePromptTemplate).trim();
    if (fresh) return fresh;
    return stringOf2(cfg.selfiePrompt).trim();
  }
  /** 「出镜自拍」开了、但生图协议是 ComfyUI 且没单独配 selfieApi —— 自拍/汇报配图应整体停用。 */
  comfySelfieBlocked(cfg) {
    const proto = stringOf2(cfg.imageProtocol).trim().toLowerCase();
    return proto === "comfyui" && !stringOf2(cfg.selfieApi).trim();
  }
  /**
   * 空镜（没开自拍）的模板配置。
   *
   * 单独一套模板而不是复用自拍那套：自拍模板里有「画面里只有她一个人」，
   * 套到风景上就把空镜画成了人像 —— 上游空镜的纪律恰恰是「画面里没有人物」。
   * `image_prompt_for_scene=false` 时返回 null，回到「上游发什么就发什么」的老行为。
   */
  sceneOptions() {
    const cfg = this.cfg;
    if (!cfg || cfg.imagePromptForScene === false) return null;
    return {
      enabled: true,
      promptTemplate: stringOf2(cfg.imagePromptSceneTemplate).trim() || DEFAULT_SCENE_TEMPLATE,
      style: this.imageStyle(),
      subject: stringOf2(cfg.selfieSubject)
    };
  }
  /** 用户填的「画面风格」（`image_style`）；`none` 与空串在模板渲染时才区分。 */
  imageStyle() {
    const cfg = this.cfg;
    return cfg ? stringOf2(cfg.imageStyle).trim() : "";
  }
  /**
   * 「生图模型名」列表。上游只认一个字符串，所以列表由套壳维护：
   * Python 侧写成 `imageModels`，老的 `imageModel` 字符串也兼容。
   */
  imageModels() {
    const cfg = this.cfg;
    if (!cfg) return [];
    return modelListOf2(cfg.imageModels ?? cfg.imageModel);
  }
  installSelfie() {
    this.uninstallSelfie?.();
    this.uninstallSelfie = null;
    const selfie = this.selfieOptions();
    const models = this.imageModels();
    if (!selfie && this.cfg && this.comfySelfieBlocked(this.cfg)) {
      this.log.info("\u751F\u56FE\u534F\u8BAE\u662F ComfyUI\uFF1A\u81EA\u62CD\u5957\u58F3\u4E0E\u4E3B\u52A8\u6C47\u62A5\u914D\u56FE\u4E0D\u751F\u6548\uFF08\u8981\u7528\u7684\u8BDD\u5355\u72EC\u914D selfie_api \u6307\u5411\u4E91\u7AEF\u751F\u56FE\u670D\u52A1\uFF09\u3002");
    }
    const scene = selfie ? null : this.sceneOptions();
    if (!selfie && !scene && models.length === 0) return;
    const proxy = installPhotoProxy({ models, selfie, scene, clock: () => this.localClock() }, this.log);
    this.uninstallSelfie = proxy.uninstall;
    this.proxyFetch = proxy.fetch;
    if (selfie) {
      this.log.info(
        `\u81EA\u62CD\u5957\u58F3\u5DF2\u542F\u7528\uFF1A${selfie.mode} \u6A21\u5F0F\uFF0C\u53C2\u8003\u56FE ${selfie.references.length} \u5F20${selfie.references.length ? "" : "\uFF08\u7F3A\u5931\uFF0C\u7167\u7247\u4F1A\u5931\u8D25\uFF09"}`
      );
    }
    if (models.length > 1) {
      this.log.info(`\u751F\u56FE\u6A21\u578B\u964D\u7EA7\u5DF2\u542F\u7528\uFF1A${models.join(" \u2192 ")}`);
    }
    const cfg = this.cfg;
    const templateSource = cfg && stringOf2(cfg.imagePromptTemplate).trim() ? "image_prompt_template" : cfg && stringOf2(cfg.selfiePrompt).trim() ? "selfie_prompt\uFF08\u65E7\u5B57\u6BB5\uFF09" : "\u5185\u7F6E\u9ED8\u8BA4";
    this.log.info(
      `\u751F\u56FE\u63D0\u793A\u8BCD\uFF1A\u753B\u98CE\u300C${this.imageStyle() || "\uFF08\u7559\u7A7A=\u771F\u5B9E\u65C5\u884C\u7167\u7247\uFF09"}\u300D\uFF5C\u6A21\u677F ${templateSource}\uFF5C\u7A7A\u955C\u5957\u6A21\u677F ${scene ? "\u5F00" : "\u5173"}`
    );
  }
  /**
   * 她所在城市的当地时间 `HH:MM`（来自 raw 的 UI 快照）。
   *
   * 自拍模板里的 `{time}` / `{clock}` 用它：不能用本机时间 —— 她可能在
   * 另一个时区，本机中午对她那边可能是深夜。取不到时返回空串，
   * 由 `describeTime()` 退回本机时间，只影响描述词，不影响生图。
   */
  async localClock() {
    try {
      const snap = await this.snapshot();
      const clock = typeof snap.clock === "string" ? snap.clock.trim() : "";
      return /^([01]\d|2[0-3]):[0-5]\d$/.test(clock) ? clock : null;
    } catch {
      return null;
    }
  }
  /**
   * 主动汇报附图：和 `/journey_photo`、自动拍照用**同一个场景描述**（上游
   * `photoPrompt()`，含用户的「画面风格」），末尾再附一行她此刻在做什么。
   * 不写上游 photo 事件、不进相册。
   *
   * 以前这里直接拿汇报文本当提示词，`image_style` 一个字都不参与 —— 同一个人设，
   * 相册里是动漫、主动汇报里是真人照片。上游导入失败或快照缺字段时退回旧写法，
   * 汇报照发，绝不因为配图链路挂掉而丢整条消息。
   */
  async reportImage(scene) {
    const options = this.selfieOptions();
    if (!options) return null;
    const reportText = (scene ?? "").trim().slice(0, 120);
    const fallback = reportText ? `${reportText}

\u6B64\u523B\uFF1A${this.now()}` : this.now();
    let prompt = fallback;
    try {
      const base = await buildScenePrompt(await this.snapshot(), this.imageStyle());
      prompt = reportText ? `${base}

\u5979\u6B64\u523B\uFF1A${reportText}` : base;
    } catch (e) {
      this.log.warn(`\u6C47\u62A5\u914D\u56FE\u9000\u56DE\u65E7\u63D0\u793A\u8BCD\uFF1A${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      const clock = await this.localClock();
      const image = await generateSelfieBytes(prompt, options, this.proxyFetch, this.log, clock ?? void 0);
      return image.bytes;
    } catch (e) {
      this.log.warn(`\u6C47\u62A5\u914D\u56FE\u5931\u8D25\uFF1A${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }
  resolveReference(ref) {
    if (/^(https?:|data:)/i.test(ref) || isAbsolute(ref)) return ref;
    const bases = [dirname5(this.rawDir), this.dataDir, process.cwd()];
    for (const base of bases) {
      const candidate = join9(base, ref);
      if (existsSync8(candidate)) return candidate;
    }
    return join9(dirname5(this.rawDir), ref);
  }
  w() {
    if (!this.world) throw new Error("raw \u8FD8\u6CA1\u542F\u52A8");
    return this.world;
  }
  static silent() {
    return SILENT_LOGGER;
  }
};
function normalizeToolResult(value) {
  if (value && typeof value === "object") {
    const v = value;
    return {
      text: sanitizePlatformText(String(v.text ?? "")),
      ...v.isError === true ? { isError: true } : {}
    };
  }
  return { text: sanitizePlatformText(String(value ?? "")) };
}
function stringOf2(value) {
  return typeof value === "string" ? value : "";
}
function modelListOf2(value) {
  const raw = typeof value === "string" ? value.split(/[\n,，;；]+/) : Array.isArray(value) ? value : [];
  const out = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

// adapter/sim.ts
import { rmSync, writeFileSync as writeFileSync3 } from "node:fs";
import { join as join10 } from "node:path";

// adapter/compat/private.ts
var TIMER_KEYS = ["timer", "bootTimer", "wishTimer"];
function pauseTimers(world) {
  const w = world;
  for (const key of TIMER_KEYS) {
    const handle2 = w[key];
    if (!handle2) continue;
    clearInterval(handle2);
    clearTimeout(handle2);
    w[key] = null;
  }
}
async function tick(world) {
  const w = world;
  if (typeof w.tick !== "function") {
    throw new Error(
      "\u4E0A\u6E38 JourneyWorld \u7684\u79C1\u6709 tick \u4E0D\u89C1\u4E86\u3002\u751F\u4EA7 sidecar \u4E0D\u4F9D\u8D56\u5B83\uFF1B\u8BF7\u66F4\u65B0 adapter/compat/private.ts \u540E\u91CD\u8DD1\u6A21\u62DF\u3002"
    );
  }
  await w.tick.call(world);
}

// adapter/sim.ts
var RESET_FILES = ["state.json", "photos.json", "events.jsonl", "events.meta.json", "sim-report.json", "ui.json"];
async function runSimulation(opts) {
  if (!Number.isFinite(opts.days) || opts.days <= 0) throw new Error("--days \u5FC5\u987B\u662F\u6B63\u6570");
  const stepMinutes = Math.max(1, opts.stepMinutes ?? 10);
  const speed = Math.min(240, Math.max(0.1, opts.speed ?? 1));
  const seed = Math.trunc(opts.seed ?? 1);
  const from = opts.from ?? /* @__PURE__ */ new Date();
  const offline = opts.offline ?? true;
  if (opts.reset) {
    for (const name of RESET_FILES) rmSync(join10(opts.dataDir, name), { force: true });
  }
  const collected = [];
  let now = new Date(from.getTime());
  const originalRandom = Math.random;
  const originalFetch = globalThis.fetch;
  Math.random = seededRandom(seed);
  if (offline) {
    globalThis.fetch = (async () => {
      throw new Error("offline");
    });
  }
  const bridge = new RawBridge({
    dataDir: opts.dataDir,
    ...opts.configPath ? { configPath: opts.configPath } : {},
    ...opts.promptPath ? { promptPath: opts.promptPath } : {},
    initialOverrides: { speed, ...opts.homeCity ? { homeCity: opts.homeCity } : {} },
    now: () => now,
    nowPlaying: () => null,
    echo: opts.echo ?? false,
    onEvent: (e) => collected.push(e)
  });
  const started = Date.now();
  try {
    await bridge.start();
    pauseTimers(bridge.rawWorld);
    const ticks = Math.max(1, Math.ceil(opts.days * 24 * 60 / stepMinutes));
    const realStepMs = stepMinutes * 6e4 / speed;
    for (let i = 0; i < ticks; i++) {
      now = new Date(now.getTime() + realStepMs);
      await tick(bridge.rawWorld);
    }
    const snap = await bridge.snapshot();
    const eventsByType = {};
    const keyCount = /* @__PURE__ */ new Map();
    for (const e of collected) {
      eventsByType[e.type] = (eventsByType[e.type] ?? 0) + 1;
      keyCount.set(e.key, (keyCount.get(e.key) ?? 0) + 1);
    }
    const duplicateKeys = [...keyCount.entries()].filter(([, n]) => n > 1).map(([k]) => k);
    const report = {
      days: opts.days,
      speed,
      seed,
      stepMinutes,
      from: from.toISOString(),
      until: now.toISOString(),
      ticks,
      events: collected.length,
      eventsByType,
      duplicateKeys,
      citiesVisited: snap.trip.visited,
      final: {
        phase: snap.mode,
        place: snap.place.name,
        dateKey: snap.dateKey,
        clock: snap.clock,
        visited: snap.trip.visited,
        diaryDays: snap.diary.days,
        photos: snap.photos.length
      },
      upstreamVersion: bridge.upstreamVersion,
      elapsedMs: Date.now() - started
    };
    try {
      writeFileSync3(join10(opts.dataDir, "sim-report.json"), `${JSON.stringify(report, null, 2)}
`, "utf8");
    } catch {
    }
    await bridge.stop();
    return report;
  } finally {
    Math.random = originalRandom;
    globalThis.fetch = originalFetch;
    try {
      pauseTimers(bridge.rawWorld);
    } catch {
    }
  }
}
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 1831565813 >>> 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// adapter/server.ts
import { createServer as createHttpServer } from "node:http";
var BODY_LIMIT = 64 * 1024;
var HEARTBEAT_TIMEOUT_MS = 9e4;
function createServer(opts) {
  return createHttpServer((req, res) => {
    void handle(req, res, opts).catch((e) => {
      json(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
    });
  });
}
async function startServer(opts) {
  const server = createServer(opts);
  const port = opts.port ?? 0;
  const host = opts.host ?? "127.0.0.1";
  await new Promise((resolve2, reject) => {
    const onError = (e) => {
      server.off("error", onError);
      reject(e);
    };
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve2();
    });
  });
  const actual = server.address().port;
  if (opts.announce ?? true) {
    console.log(JSON.stringify({ event: "listening", port: actual }));
  }
  return {
    server,
    port: actual,
    close: () => new Promise((resolve2, reject) => {
      server.close((e) => e ? reject(e) : resolve2());
    })
  };
}
function startHeartbeatWatchdog(opts, onStale = () => process.exit(0)) {
  let last = Date.now();
  const timer = setInterval(() => {
    if (Date.now() - last > HEARTBEAT_TIMEOUT_MS) {
      opts.bridge.log.warn("Python \u63D2\u4EF6\u5FC3\u8DF3\u8D85\u65F6\uFF0Csidecar \u9000\u51FA\uFF0C\u907F\u514D\u7559\u4E0B\u5B64\u513F\u8FDB\u7A0B\u3002");
      clearInterval(timer);
      onStale();
    }
  }, 15e3);
  return {
    touch: () => {
      last = Date.now();
    },
    stop: () => clearInterval(timer)
  };
}
async function handle(req, res, opts) {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const path = url.pathname;
  if (!authorized(req, opts.token)) {
    json(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  opts.bridge.reloadConfig();
  if (method === "GET" && path === "/api/health") {
    json(res, 200, { ...opts.bridge.health(), uptimeSec: Math.round(process.uptime()) });
    return;
  }
  if (method === "GET" && path === "/api/status") {
    const snapshot = await opts.bridge.snapshot();
    json(res, 200, {
      ...snapshot,
      now: opts.bridge.now(),
      promptWarnings: opts.bridge.prompt().warnings,
      upstreamVersion: opts.bridge.upstreamVersion,
      bridgeVersion: opts.bridge.bridgeVersion,
      eventLogId: opts.bridge.eventLogId,
      lastSeq: opts.bridge.lastSeq
    });
    return;
  }
  if (method === "GET" && path === "/api/now") {
    text2(res, 200, opts.bridge.now());
    return;
  }
  if (method === "GET" && path === "/api/events") {
    const after = Number(url.searchParams.get("after") ?? 0);
    const limit = Math.max(1, Math.min(1e3, Number(url.searchParams.get("limit") ?? 200)));
    const cursor = Number.isFinite(after) ? after : 0;
    json(res, 200, {
      events: opts.bridge.events.after(cursor, limit),
      lastSeq: opts.bridge.lastSeq,
      eventLogId: opts.bridge.eventLogId
    });
    return;
  }
  if (method === "GET" && path === "/api/tools") {
    json(res, 200, {
      tools: opts.bridge.tools().map(({ handler: _handler, ...rest }) => rest)
    });
    return;
  }
  if (method === "GET" && path === "/api/prompt") {
    const prompt = opts.bridge.prompt();
    if (prompt.missing.length) {
      text2(res, 500, `\u63D0\u793A\u8BCD\u7F3A\u5C11\u53D8\u91CF\uFF1A${prompt.missing.join("\u3001")}`);
      return;
    }
    text2(res, 200, prompt.text, "text/markdown; charset=utf-8");
    return;
  }
  if (method === "POST" && path.startsWith("/api/tools/")) {
    const name = decodeURIComponent(path.slice("/api/tools/".length));
    if (!name) {
      json(res, 400, { ok: false, error: "\u7F3A\u5C11\u5DE5\u5177\u540D" });
      return;
    }
    const body = await readJsonBody(req);
    const result = await opts.bridge.callTool(name, body);
    json(res, result.isError ? 400 : 200, result);
    return;
  }
  if (method === "POST" && path === "/api/depart") {
    const result = await opts.bridge.depart();
    json(res, result.ok ? 200 : 409, result);
    return;
  }
  if (method === "POST" && path === "/api/sync") {
    const result = await opts.bridge.sync();
    json(res, result.ok ? 200 : 409, result);
    return;
  }
  if (method === "POST" && path === "/api/photo") {
    const result = await opts.bridge.photo();
    json(res, result.ok ? 200 : 409, result);
    return;
  }
  if (method === "POST" && path === "/api/ask") {
    const raw = await readJsonBody(req);
    const ok = raw && typeof raw === "object" && !Array.isArray(raw) ? raw.ok === true : false;
    const result = await opts.bridge.askAnswer(ok);
    json(res, result.ok ? 200 : 409, result);
    return;
  }
  if (method === "POST" && path === "/api/return-home") {
    const result = await opts.bridge.returnHome();
    json(res, result.ok ? 200 : 409, result);
    return;
  }
  if (method === "POST" && path === "/api/report-image") {
    const raw = await readJsonBody(req);
    const body = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const scene = typeof body.text === "string" ? body.text : "";
    const bytes = await opts.bridge.reportImage(scene);
    json(res, 200, {
      ok: Boolean(bytes),
      image: bytes ? Buffer.from(bytes).toString("base64") : null
    });
    return;
  }
  if (method === "POST" && path === "/api/heartbeat") {
    opts.touchHeartbeat?.();
    json(res, 200, { ok: true });
    return;
  }
  if (method === "GET" && path.startsWith("/media/")) {
    const name = decodeURIComponent(path.slice("/media/".length));
    const bytes = opts.bridge.media.read(name);
    if (!bytes) {
      json(res, 404, { ok: false, error: "\u6CA1\u6709\u8FD9\u5F20\u56FE" });
      return;
    }
    res.writeHead(200, {
      "content-type": opts.bridge.media.mimeOf(name),
      "content-length": String(bytes.length),
      "cache-control": "public, max-age=31536000, immutable"
    });
    res.end(bytes);
    return;
  }
  json(res, 404, { ok: false, error: `\u6CA1\u6709\u8FD9\u4E2A\u63A5\u53E3\uFF1A${method} ${path}` });
}
function authorized(req, token) {
  if (!token) return false;
  const header = req.headers.authorization ?? "";
  return header === `Bearer ${token}`;
}
function json(res, status, value) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}
function text2(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}
async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > BODY_LIMIT) throw new Error("\u8BF7\u6C42\u4F53\u592A\u5927");
    chunks.push(buf);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("\u8BF7\u6C42\u4F53\u4E0D\u662F\u5408\u6CD5 JSON");
  }
}

// adapter/cli.ts
var VERSION = "1.0.2";
var OPTIONS = {
  data: { type: "string" },
  config: { type: "string" },
  prompt: { type: "string" },
  port: { type: "string" },
  token: { type: "string" },
  offline: { type: "boolean" },
  verbose: { type: "boolean" },
  "require-heartbeat": { type: "boolean" },
  days: { type: "string" },
  speed: { type: "string" },
  seed: { type: "string" },
  step: { type: "string" },
  from: { type: "string" },
  home: { type: "string" },
  reset: { type: "boolean" },
  out: { type: "string" },
  help: { type: "boolean" }
};
async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: OPTIONS, strict: true });
  const cmd = positionals[0] ?? "help";
  if (cmd === "help" || values.help) {
    printHelp();
    return;
  }
  const dataDir = resolve(values.data ?? (cmd === "sim" ? "./data/sim" : "./data"));
  const common = {
    dataDir,
    ...values.config ? { configPath: resolve(values.config) } : {},
    ...values.prompt ? { promptPath: resolve(values.prompt) } : {}
  };
  switch (cmd) {
    case "serve":
      await cmdServe(common, values);
      return;
    case "status":
      await cmdStatus(common, values);
      return;
    case "prompt":
      await cmdPrompt(common, values);
      return;
    case "sim":
      await cmdSim(dataDir, values);
      return;
    case "check":
      cmdCheck();
      return;
    default:
      console.error(`\u4E0D\u8BA4\u8BC6\u8FD9\u4E2A\u547D\u4EE4\uFF1A${cmd}`);
      printHelp();
      process.exitCode = 2;
  }
}
async function cmdServe(common, values) {
  const token = typeof values.token === "string" && values.token ? values.token : process.env.JOURNEY_SIDECAR_TOKEN?.trim();
  if (!token) throw new Error("serve \u9700\u8981 --token \u6216 JOURNEY_SIDECAR_TOKEN");
  const restoreNetwork = values.offline === true ? disableNetwork() : null;
  const bridge = new RawBridge({
    ...common,
    echo: false,
    verbose: values.verbose === true
  });
  await bridge.start();
  let watchdog = null;
  if (values["require-heartbeat"] === true) {
    watchdog = startHeartbeatWatchdog({ bridge, token, requireHeartbeat: true });
  }
  const port = values.port !== void 0 ? numberOrThrow(values.port, "--port") : 0;
  const server = await startServer({
    bridge,
    token,
    requireHeartbeat: values["require-heartbeat"] === true,
    port,
    announce: true,
    ...watchdog ? { touchHeartbeat: watchdog.touch } : {}
  });
  bridge.log.info(`sidecar \u5DF2\u542F\u52A8\uFF0C\u7BA1\u9053 ${server.port}\uFF0C\u4E0A\u6E38 ${bridge.upstreamVersion}\u3002`);
  await waitForSignal();
  watchdog?.stop();
  await server.close();
  await bridge.stop();
  restoreNetwork?.();
}
async function cmdStatus(common, values) {
  const restoreNetwork = values.offline === true ? disableNetwork() : null;
  const bridge = new RawBridge({ ...common, echo: false, verbose: values.verbose === true });
  try {
    await bridge.start();
    const snapshot = await bridge.snapshot();
    console.log(bridge.now());
    console.log("");
    console.log(JSON.stringify({
      ...snapshot,
      upstreamVersion: bridge.upstreamVersion,
      bridgeVersion: VERSION
    }, null, 2));
  } finally {
    await bridge.stop();
    restoreNetwork?.();
  }
}
async function cmdPrompt(common, values) {
  const restoreNetwork = values.offline === true ? disableNetwork() : null;
  const bridge = new RawBridge({ ...common, echo: false, verbose: values.verbose === true });
  try {
    await bridge.start();
    const prompt = bridge.prompt();
    if (prompt.missing.length) {
      console.error(`[prompt] \u6A21\u677F\u91CC\u6709\u672A\u8D4B\u503C\u7684\u53D8\u91CF\uFF1A${prompt.missing.join("\u3001")}`);
      process.exitCode = 1;
    }
    const out = resolve(typeof values.out === "string" ? values.out : join11(common.dataDir, "prompt.md"));
    writeFileSync4(out, prompt.text, "utf8");
    console.log(`[prompt] \u5DF2\u5199\u5165 ${out}`);
    console.log(`[prompt] \u6A21\u677F ${prompt.path}`);
    for (const w of prompt.warnings) console.error(`[prompt] \u8B66\u544A\uFF1A${w}`);
  } finally {
    await bridge.stop();
    restoreNetwork?.();
  }
}
async function cmdSim(dataDir, values) {
  const days = values.days !== void 0 ? numberOrThrow(values.days, "--days") : 7;
  const speed = values.speed !== void 0 ? numberOrThrow(values.speed, "--speed") : 24;
  const seed = values.seed !== void 0 ? numberOrThrow(values.seed, "--seed") : 1;
  const stepMinutes = values.step !== void 0 ? numberOrThrow(values.step, "--step") : 10;
  const from = values.from !== void 0 ? dateOrThrow(values.from, "--from") : void 0;
  const report = await runSimulation({
    dataDir,
    days,
    speed,
    seed,
    stepMinutes,
    ...from ? { from } : {},
    ...values.home !== void 0 ? { homeCity: String(values.home) } : {},
    offline: values.offline !== false,
    reset: values.reset === true,
    echo: false,
    ...values.config ? { configPath: resolve(String(values.config)) } : {},
    ...values.prompt ? { promptPath: resolve(String(values.prompt)) } : {}
  });
  console.log("");
  console.log(`[sim] ${report.days} \u5929 @${report.speed}x\uFF0Cseed=${report.seed}\uFF0C${report.ticks} \u6B21 tick\uFF0C${report.elapsedMs}ms`);
  console.log(`[sim] \u4E8B\u4EF6 ${report.events} \u6761\uFF1A${formatCounts(report.eventsByType)}`);
  console.log(`[sim] \u4E0A\u6E38 ${report.upstreamVersion}\uFF1B\u5230\u8FC7 ${report.citiesVisited} \u4E2A\u5730\u65B9\uFF1B\u6700\u540E\u5728 ${report.final.place}\uFF08${report.final.phase}\uFF09`);
  if (report.duplicateKeys.length) {
    console.log(`[sim] \u26A0 \u91CD\u590D\u4E8B\u4EF6 key\uFF1A${report.duplicateKeys.slice(0, 8).join("\u3001")}`);
  }
  console.log(`[sim] \u62A5\u544A\uFF1A${join11(dataDir, "sim-report.json")}`);
}
function cmdCheck() {
  const info = readUpstreamInfo();
  console.log(`[check] \u4E0A\u6E38\u7248\u672C\uFF1A${info.version}`);
  console.log(`[check] \u6784\u5EFA\u65F6\u95F4\uFF1A${info.builtAt ?? "\u5F00\u53D1\u6001"}`);
  console.log("[check] \u8BE6\u7EC6\u5951\u7EA6\u68C0\u67E5\u8BF7\u8DD1 npm test\uFF08test/upstream.test.ts\uFF09\u3002");
}
function printHelp() {
  console.log([
    "\u5927\u80A5\u9C7C\u73AF\u6E38\u4E16\u754C \xB7 AstrBot \u5957\u58F3",
    "",
    "\u7528\u6CD5\uFF1Atsx adapter/cli.ts <\u547D\u4EE4> [\u9009\u9879]",
    "",
    "\u547D\u4EE4\uFF1A",
    "  serve   \u542F\u52A8\u56DE\u73AF HTTP sidecar\uFF08Python \u63D2\u4EF6\u7528\uFF09",
    "  status  \u6253\u5370\u5979\u6B64\u523B\u4E0E\u5FEB\u7167 JSON",
    "  prompt  \u6E32\u67D3 ENV_PROMPT.md \u5230\u6587\u4EF6",
    "  sim     \u865A\u62DF\u65F6\u949F\u6A21\u62DF\uFF08\u9ED8\u8BA4 7 \u5929\u300124x\u3001seed 1\uFF09",
    "  check   \u6253\u5370\u4E0A\u6E38\u7248\u672C",
    "",
    "\u901A\u7528\uFF1A--data <dir> --config <file> --prompt <file> --offline --verbose",
    "serve\uFF1A--port 0 --token <token> --require-heartbeat",
    "sim\uFF1A--days --speed --seed --step --from --home --reset",
    "prompt\uFF1A--out <file>"
  ].join("\n"));
}
function numberOrThrow(raw, name) {
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${name} \u4E0D\u662F\u6570\u5B57\uFF1A${String(raw)}`);
  return n;
}
function dateOrThrow(raw, name) {
  const d = new Date(String(raw));
  if (!Number.isFinite(d.getTime())) throw new Error(`${name} \u4E0D\u662F\u5408\u6CD5\u65F6\u95F4\uFF1A${String(raw)}`);
  return d;
}
function formatCounts(counts) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return entries.length ? entries.map(([k, v]) => `${k.replace("journey.", "")} ${v}`).join("\uFF0C") : "\uFF08\u6CA1\u6709\uFF09";
}
function disableNetwork() {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("offline");
  });
  return () => {
    globalThis.fetch = original;
  };
}
function waitForSignal() {
  return new Promise((resolvePromise) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolvePromise();
    };
    process.once("SIGINT", finish);
    process.once("SIGTERM", finish);
  });
}
void main().catch((e) => {
  console.error(`[fatal] ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
//# sourceMappingURL=sidecar.mjs.map
