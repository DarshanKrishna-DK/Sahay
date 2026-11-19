"use strict";

// server.js: Content-Security-Policy + Subresource Integrity (security review r1 #11),
// ending sessions a crashed process left open (#12) and the listen host (#14).

Object.assign(process.env, {
  DB_FILE: ":memory:",
  SESSION_SIGNING_SECRET: "test-secret-".padEnd(48, "x"),
  PUBLIC_URL: "https://sahay.test",
  AGORA_APP_ID: "0123456789abcdef0123456789abcdef",
  AGORA_APP_CERTIFICATE: "fedcba9876543210fedcba9876543210", // fake test value
  AGORA_CUSTOMER_ID: "test-customer",
  AGORA_CUSTOMER_SECRET: "test-customer-secret",
  TELEGRAM_BOT_TOKEN: "",
  SAHAY_ACCESS_CODE: "",
});

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const server = require("../server");
const repo = require("../src/db/repo");
const { loadConfig } = require("../src/config");
const { VENDOR_PAGE } = require("../src/routes/api");

const PUBLIC = path.join(__dirname, "..", "public");
const readPage = (name) => (fs.existsSync(path.join(PUBLIC, name)) ? fs.readFileSync(path.join(PUBLIC, name), "utf8") : "");
const indexHtml = readPage("index.html");
const appHtml = readPage("app.html");
// The page that loads the voice client holds the toolkit's import map: app.html (index.html until the app lands).
const voicePageHtml = /<script type="importmap">/.test(appHtml) ? appHtml : indexHtml;
const voiceJs = fs.readFileSync(path.join(PUBLIC, "js", "voice.js"), "utf8");

async function withApp(run, options) {
  const s = await new Promise((resolve) => {
    const x = server.createApp(options).listen(0, "127.0.0.1", () => resolve(x));
  });
  try {
    await run(`http://127.0.0.1:${s.address().port}`);
  } finally {
    await new Promise((resolve) => s.close(resolve));
  }
}

function directives(csp) {
  return Object.fromEntries(csp.split(";").map((d) => d.trim()).filter(Boolean).map((d) => {
    const [name, ...values] = d.split(/\s+/);
    return [name, values];
  }));
}

test("every page answer carries a CSP: self, the pinned CDN files, no inline script except hashed ones", async () => {
  await withApp(async (base) => {
    for (const p of ["/", "/js/app.js", "/vendor/somecode", "/healthz"]) {
      const res = await fetch(base + p);
      const csp = res.headers.get("content-security-policy");
      assert.ok(csp, `CSP on ${p}`);
      const d = directives(csp);
      assert.deepEqual(d["default-src"], ["'self'"]);
      assert.ok(!d["script-src"].includes("'unsafe-inline'"), "no inline script");
      assert.ok(!d["script-src"].includes("'unsafe-eval'"), "no eval");
      assert.ok(!d["script-src"].some((s) => s === "https:" || s.endsWith("*")), "no wildcard script origins");
      assert.deepEqual(d["object-src"], ["'none'"]);
      assert.deepEqual(d["frame-ancestors"], ["'none'"]);
      assert.deepEqual(d["base-uri"], ["'none'"]);
    }
  });
});

test("SRI: every CDN script the console and the vendor page load is pinned, integrity-checked and allowed by script-src", async () => {
  const csp = directives(server.contentSecurityPolicy());
  const scriptSrc = csp["script-src"];

  // Dynamically injected UMD bundles in voice.js carry their own integrity.
  const injected = [...voiceJs.matchAll(/src:\s*"(https:[^"]+)",\s*integrity:\s*"(sha384-[A-Za-z0-9+/=]+)"/g)];
  assert.equal(injected.length, 2, "RTC and RTM bundles");
  assert.match(voiceJs, /crossOrigin = "anonymous"/);
  assert.match(voiceJs, /\.integrity = /);

  // The toolkit ES module is checked through the import map's integrity section.
  const map = /<script type="importmap">([\s\S]*?)<\/script>/.exec(voicePageHtml);
  assert.ok(map, "the voice page has an import map");
  const integrity = JSON.parse(map[1]).integrity;
  const toolkit = /const TOOLKIT_URL = "([^"]+)"/.exec(voiceJs)[1];
  assert.match(integrity[toolkit], /^sha384-/);

  // The vendor page loads the same RTC bundle with the same hash.
  const vendorTag = /<script src="(https:[^"]+)" integrity="(sha384-[^"]+)" crossorigin="anonymous"><\/script>/.exec(VENDOR_PAGE);
  assert.ok(vendorTag, "vendor page RTC tag has SRI");
  assert.deepEqual([vendorTag[1], vendorTag[2]], [injected[0][1], injected[0][2]]);
  assert.doesNotMatch(VENDOR_PAGE, /<script>/, "no inline script on the vendor page");

  for (const url of [...injected.map((m) => m[1]), toolkit, vendorTag[1]]) {
    assert.match(url, /@\d+\.\d+\.\d+\//, `${url} is an exact version`);
    assert.ok(scriptSrc.includes(url), `script-src allows exactly ${url}`);
  }
  // Every https script URL anywhere in public/ is one of those.
  const all = new Set([...(indexHtml + appHtml + voiceJs).matchAll(/https:\/\/[^"'\s)]+\.m?js\b/g)].map((m) => m[0]));
  for (const url of all) assert.ok(scriptSrc.includes(url), `${url} is allowed by script-src`);
});

test("the only inline script of the voice page is the import map, allowed by its sha256 hash", () => {
  const inline = [...voicePageHtml.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.equal(inline.length, 1);
  assert.match(inline[0][1], /type="importmap"/);
  const hash = `'sha256-${crypto.createHash("sha256").update(inline[0][2]).digest("base64")}'`;
  assert.ok(directives(server.contentSecurityPolicy())["script-src"].includes(hash));
  assert.deepEqual(server.inlineScriptHashes("<script>a\r\nb</script>"), server.inlineScriptHashes("<script>a\nb</script>"), "CRLF hashed as the HTML parser sees it");
});

test("/app serves app.html and / the landing page; the CSP hashes inline scripts of both pages", async () => {
  const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "sahay-public-"));
  const map = '{"integrity":{"https://cdn.jsdelivr.net/npm/x@1.0.0/x.mjs":"sha384-abc"}}';
  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>landing page</title>");
  fs.writeFileSync(path.join(dir, "app.html"), `<!doctype html><title>app page</title><script type="importmap">${map}</script>`);
  try {
    await withApp(async (base) => {
      for (const [p, title] of [["/", "landing page"], ["/app", "app page"], ["/app/", "app page"]]) {
        const res = await fetch(base + p);
        assert.equal(res.status, 200, p);
        assert.match(res.headers.get("content-type"), /^text\/html/, p);
        assert.match(await res.text(), new RegExp(`<title>${title}</title>`), p);
        const scriptSrc = directives(res.headers.get("content-security-policy"))["script-src"];
        assert.ok(scriptSrc.includes(`'sha256-${crypto.createHash("sha256").update(map).digest("base64")}'`), `import map hash on ${p}`);
      }
      assert.equal((await fetch(base + "/app/nothing-here")).status, 404);
    }, { publicDir: dir });
  } finally {
    server.createApp(); // back to the real public/ CSP for the other tests
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing app.html is a 404, not a crash", async () => {
  const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "sahay-public-"));
  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>landing page</title>");
  try {
    await withApp(async (base) => {
      assert.equal((await fetch(base + "/app")).status, 404);
      assert.equal((await fetch(base + "/")).status, 200);
    }, { publicDir: dir });
  } finally {
    server.createApp();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("script-src allows exactly the pinned GSAP 3.13.0, ScrollTrigger and Lenis files, each with a sha384", () => {
  const scriptSrc = directives(server.contentSecurityPolicy())["script-src"];
  const expected = [
    "https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/gsap.min.js",
    "https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/ScrollTrigger.min.js",
    "https://cdn.jsdelivr.net/npm/lenis@1.3.27/dist/lenis.min.js",
  ];
  assert.deepEqual(Object.keys(server.LANDING_SCRIPTS), expected);
  for (const url of expected) {
    assert.ok(scriptSrc.includes(url), `script-src lists ${url}`);
    assert.ok(server.CDN_SCRIPTS.includes(url));
    assert.match(server.LANDING_SCRIPTS[url], /^sha384-[A-Za-z0-9+/]{64}$/);
  }
  assert.ok(!scriptSrc.some((s) => /gsap@3\.13\.0\/?$|lenis@1\.3\.27\/?$|\/dist\/$/.test(s)), "files, never package folders");
});

test("the landing page loads GSAP, ScrollTrigger and Lenis with the server's pinned sha384 and no inline script", () => {
  assert.doesNotMatch(indexHtml, /<script type="importmap">/, "the landing page is not the voice page");
  const tags = [...indexHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.equal(tags.length, 5, "boot, GSAP, ScrollTrigger, Lenis, main module");
  assert.ok(tags.every((m) => /\bsrc="/.test(m[1]) && m[2].trim() === ""), "every script is an external file");
  const cdn = tags.map((m) => m[1]).filter((a) => /src="https:/.test(a)).map((attrs) => ({
    src: /src="([^"]+)"/.exec(attrs)[1],
    integrity: /integrity="([^"]+)"/.exec(attrs)?.[1],
    crossorigin: /crossorigin="([^"]+)"/.exec(attrs)?.[1],
  }));
  assert.deepEqual(cdn.map((c) => c.src), Object.keys(server.LANDING_SCRIPTS));
  for (const c of cdn) {
    assert.equal(c.integrity, server.LANDING_SCRIPTS[c.src], `${c.src} integrity`);
    assert.equal(c.crossorigin, "anonymous");
  }
  // Every local file the page asks for exists.
  const local = [...indexHtml.matchAll(/(?:src|href)="(\/[^"#]*)"/g)].map((m) => m[1]).filter((u) => !u.startsWith("/app"));
  for (const u of local) assert.ok(fs.existsSync(path.join(PUBLIC, u)), `${u} exists`);
  // The disclosure is on the page in its static HTML, not only after a script runs.
  assert.match(indexHtml, /Automated assistant/);
  assert.match(indexHtml, /never orders or pays without your yes/);
});

test("landing words exist in Hindi, Kannada and English, in native script", async () => {
  // public/ is browser ES modules in a CommonJS package: load the file's text as a module.
  const source = fs.readFileSync(path.join(PUBLIC, "js", "landing", "i18n.js"), "utf8");
  const i18n = await import(`data:text/javascript,${encodeURIComponent(source)}`);
  const keys = new Set([...indexHtml.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]));
  for (const m of indexHtml.matchAll(/data-i18n-attr="([^"]+)"/g)) for (const pair of m[1].split(",")) keys.add(pair.split(":")[1]);
  for (const k of ["toLight", "toDark"]) keys.add(k);
  for (const key of keys) {
    for (const lang of ["en", "hi", "kn"]) assert.ok(i18n.t(key, lang), `${key} in ${lang}`);
    assert.match(i18n.t(key, "hi"), /[ऀ-ॿ]|^[\d\s₹,./:]+$|^“?[ऀ-ॿ]/u, `${key} hi is Devanagari`);
    assert.match(i18n.t(key, "kn"), /[ಀ-೿]/u, `${key} kn is Kannada`);
  }
});

test("boot ends every session a previous process left open, and returns their agents to stop", () => {
  const biz = repo.createBusiness(repo.newId("biz"), { name: "Crash Shop", language: "en-IN" });
  const active = repo.createSession(biz.id, { kind: "owner", channel: "own-a", status: "connecting" });
  repo.updateSession(biz.id, active.id, { status: "active", agent_id: "AG-ACTIVE" });
  const connecting = repo.createSession(biz.id, { kind: "owner", channel: "own-b", status: "connecting" });
  const negotiating = repo.createSession(biz.id, { kind: "negotiation", channel: "neg-c", status: "starting" });
  repo.updateSession(biz.id, negotiating.id, { agent_id: "AG-NEG" });
  const done = repo.createSession(biz.id, { kind: "owner", channel: "own-d", status: "connecting" });
  repo.updateSession(biz.id, done.id, { status: "ended", ended_at: "2026-01-01T00:00:00.000Z", agent_id: "AG-OLD" });

  const out = server.endStaleSessions("2026-11-19T00:00:00.000Z");
  assert.equal(out.ended, 3);
  assert.deepEqual(out.agentIds.sort(), ["AG-ACTIVE", "AG-NEG"]);
  for (const s of [active, connecting, negotiating]) {
    const row = repo.getSession(biz.id, s.id);
    assert.equal(row.status, "ended");
    assert.equal(row.ended_at, "2026-11-19T00:00:00.000Z");
  }
  assert.equal(repo.getSession(biz.id, done.id).ended_at, "2026-01-01T00:00:00.000Z", "already ended rows untouched");
  assert.deepEqual(server.endStaleSessions(), { ended: 0, agentIds: [] });
});

test("the MCP bearer of a session ended at boot is refused", () => {
  const auth = require("../src/auth");
  const { resolveContext } = require("../src/mcp-server");
  const biz = repo.createBusiness(repo.newId("biz"), { name: "Bearer Shop", language: "en-IN" });
  const s = repo.createSession(biz.id, { kind: "owner", channel: "own-x", status: "connecting" });
  repo.updateSession(biz.id, s.id, { status: "active", agent_id: "AGX" });
  const bearer = auth.signSession({ businessId: biz.id, sessionId: s.id, scope: "mcp", exp: Math.floor(Date.now() / 1000) + 3600 });
  assert.ok(resolveContext(`Bearer ${bearer}`));
  server.endStaleSessions();
  assert.equal(resolveContext(`Bearer ${bearer}`), null);
});

test("HOST: loopback by default, configurable for a host that needs 0.0.0.0", () => {
  assert.equal(loadConfig({}).host, "127.0.0.1");
  assert.equal(loadConfig({ HOST: "0.0.0.0" }).host, "0.0.0.0");
});
