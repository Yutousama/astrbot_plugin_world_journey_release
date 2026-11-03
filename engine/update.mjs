// adapter/update.ts
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
var DEFAULT_PACKAGE = "coopani-world-journey";
var DEFAULT_REGISTRY = "https://registry.npmjs.org";
var UpdateError = class extends Error {
};
async function main() {
  const { values } = parseArgs({
    options: {
      target: { type: "string" },
      version: { type: "string", default: "latest" },
      package: { type: "string", default: DEFAULT_PACKAGE },
      registry: { type: "string", default: DEFAULT_REGISTRY },
      install: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      rollback: { type: "string" },
      json: { type: "boolean", default: false }
    },
    strict: true
  });
  const json = values.json;
  const print = (value) => {
    console.log(json ? JSON.stringify(value) : JSON.stringify(value, null, 2));
  };
  const targetArg = values.target;
  if (!targetArg) throw new UpdateError("\u7F3A\u5C11 --target <raw \u76EE\u5F55>");
  const target = resolve(targetArg);
  const parent = dirname(target);
  const base = basename(target);
  const pkg = values.package;
  const registry = values.registry.replace(/\/+$/, "");
  if (values.rollback) {
    const backup2 = resolve(values.rollback);
    if (!existsSync(backup2)) throw new UpdateError(`\u56DE\u6EDA\u5907\u4EFD\u4E0D\u5B58\u5728\uFF1A${backup2}`);
    rmSync(target, { recursive: true, force: true });
    renameSync(backup2, target);
    print({ ok: true, rolledBack: true, target, from: backup2 });
    return;
  }
  const version = String(values.version);
  const metaUrl = version === "latest" ? `${registry}/${encodeURIComponent(pkg)}/latest` : `${registry}/${encodeURIComponent(pkg)}/${encodeURIComponent(version)}`;
  const meta = await fetchJson(metaUrl);
  const resolvedVersion = typeof meta.version === "string" ? meta.version : version;
  const dist = meta.dist ?? {};
  if (!dist.tarball) throw new UpdateError(`npm \u5143\u6570\u636E\u91CC\u6CA1\u6709 tarball\uFF1A${metaUrl}`);
  const oldVersion = readVersion(join(target, "package.json"));
  if (!values.force && oldVersion && oldVersion === resolvedVersion) {
    print({ ok: true, upToDate: true, version: resolvedVersion, target, oldVersion });
    return;
  }
  const workRoot = join(parent, `.${base}.update-${resolvedVersion}`);
  const tarballPath = join(workRoot, `${pkg}-${resolvedVersion}.tgz`);
  const extractDir = join(workRoot, "extract");
  const stageDir = join(workRoot, "package");
  rmSync(workRoot, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });
  const tarball = Buffer.from(await fetchBytes(dist.tarball));
  verifyIntegrity(tarball, dist);
  writeFileSync(tarballPath, tarball);
  const extracted = spawnSync("tar", ["-xzf", tarballPath, "-C", extractDir], {
    encoding: "utf8"
  });
  if (extracted.status !== 0) {
    throw new UpdateError(`\u89E3\u538B\u5931\u8D25\uFF08\u9700\u8981\u7CFB\u7EDF tar\uFF09\uFF1A${String(extracted.stderr || extracted.stdout || "").trim().slice(0, 300)}`);
  }
  const packageRoot = join(extractDir, "package");
  if (!existsSync(packageRoot)) throw new UpdateError("npm \u5305\u91CC\u6CA1\u6709 package/ \u76EE\u5F55");
  cpSync(packageRoot, stageDir, { recursive: true });
  validateStage(stageDir);
  let backup = null;
  let installed = false;
  if (values.install) {
    backup = join(parent, `.${base}.bak-${oldVersion || "none"}`);
    rmSync(backup, { recursive: true, force: true });
    if (existsSync(target)) renameSync(target, backup);
    renameSync(stageDir, target);
    installed = true;
    rmSync(workRoot, { recursive: true, force: true });
  } else {
    rmSync(tarballPath, { force: true });
    rmSync(extractDir, { recursive: true, force: true });
  }
  print({
    ok: true,
    version: resolvedVersion,
    oldVersion,
    target,
    stage: installed ? void 0 : stageDir,
    backup,
    installed,
    tarball: dist.tarball,
    integrity: dist.integrity,
    source: `https://www.npmjs.com/package/${pkg}`
  });
}
function validateStage(dir) {
  for (const rel of ["src/world.ts", "src/config.ts", "ENV_PROMPT.md", "package.json"]) {
    if (!existsSync(join(dir, rel))) throw new UpdateError(`\u4E0A\u6E38\u5305\u7F3A\u5C11 ${rel}\uFF0C\u62D2\u7EDD\u5B89\u88C5`);
  }
  const p = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  if (!p.version) throw new UpdateError("\u4E0A\u6E38 package.json \u6CA1\u6709 version\uFF0C\u62D2\u7EDD\u5B89\u88C5");
}
function verifyIntegrity(buf, dist) {
  const integrity = typeof dist.integrity === "string" ? dist.integrity : "";
  if (integrity.startsWith("sha512-")) {
    const got = createHash("sha512").update(buf).digest("base64");
    if (got !== integrity.slice("sha512-".length)) throw new UpdateError("npm \u5305 sha512 \u6821\u9A8C\u5931\u8D25");
    return;
  }
  if (typeof dist.shasum === "string" && dist.shasum) {
    const got = createHash("sha1").update(buf).digest("hex");
    if (got !== dist.shasum) throw new UpdateError("npm \u5305 sha1 \u6821\u9A8C\u5931\u8D25");
    return;
  }
  throw new UpdateError("npm \u5143\u6570\u636E\u6CA1\u6709 integrity/shasum\uFF0C\u62D2\u7EDD\u5B89\u88C5");
}
async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(6e4) });
  if (!res.ok) throw new UpdateError(`npm registry HTTP ${res.status}\uFF1A${url}`);
  return await res.json();
}
async function fetchBytes(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(12e4) });
  if (!res.ok) throw new UpdateError(`\u4E0B\u8F7D npm \u5305\u5931\u8D25 HTTP ${res.status}\uFF1A${url}`);
  return new Uint8Array(await res.arrayBuffer());
}
function readVersion(path) {
  try {
    const p = JSON.parse(readFileSync(path, "utf8"));
    return typeof p.version === "string" ? p.version : null;
  } catch {
    return null;
  }
}
main().catch((e) => {
  const message = e instanceof Error ? e.message : String(e);
  const wantJson = process.argv.includes("--json");
  if (wantJson) console.log(JSON.stringify({ ok: false, error: message }));
  else console.error(`[update] ${message}`);
  process.exitCode = 1;
});
//# sourceMappingURL=update.mjs.map
