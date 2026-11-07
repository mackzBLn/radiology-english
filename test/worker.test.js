// Service Worker in einer eigenen Umgebung mit nachgebauten caches und fetch, dazu Liste, Manifest und Symbole.
// Quelle zu vm: https://nodejs.org/api/vm.html

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { VERSION } from "../js/version.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const WORKER_TEXT = readFileSync(join(ROOT, "sw.js"), "utf8");
const VERSION_TEXT = readFileSync(join(ROOT, "js", "version.js"), "utf8");
const BASE = "file:///radiology-english/";
const CACHE_PREFIX = "radiology-english.app.";
const CACHE_NAME = CACHE_PREFIX + VERSION;

const NOT_APP_DIRS = new Set(["machbarkeit", "test", "node_modules"]);
const NOT_APP_FILES = new Set(["sw.js", "package.json"]);

function precacheList() {
  const lines = WORKER_TEXT.split(/\r?\n/).map((line) => line.trim());
  const start = lines.findIndex((line) => line.endsWith("PRECACHE-START"));
  const end = lines.findIndex((line) => line.endsWith("PRECACHE-END"));
  assert.ok(start >= 0 && end > start, "Die Marken PRECACHE-START und PRECACHE-END fehlen in sw.js");
  return lines.slice(start + 1, end).map((line) => JSON.parse(line.replace(/,$/, "")));
}

function appFiles(directory = ROOT) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const path = join(directory, entry.name);
    const name = relative(ROOT, path).split(sep).join("/");
    if (entry.isDirectory()) {
      if (!NOT_APP_DIRS.has(name)) {
        found.push(...appFiles(path));
      }
    } else if (!NOT_APP_FILES.has(name) && !name.endsWith(".md")) {
      found.push(name);
    }
  }
  return found;
}

class FakeRequest {
  constructor(url, init = {}) {
    this.url = new URL(url, BASE).href;
    this.cache = init.cache;
    this.method = init.method ?? "GET";
    this.mode = init.mode ?? "cors";
  }
}

function startWorker(options = {}) {
  const log = { fetched: [], precached: [], skipWaiting: 0, claim: 0, errors: [] };
  const listeners = {};
  const stores = new Map((options.existingCaches ?? []).map((name) => [name, new Map()]));

  function serve(url) {
    const path = url.slice(BASE.length);
    if ((options.missing ?? []).includes(path)) {
      return new Response("fehlt", { status: 404 });
    }
    return new Response(path === "js/version.js" ? options.versionText ?? VERSION_TEXT : "Inhalt von " + path);
  }

  function cacheOf(entries) {
    return {
      async addAll(requests) {
        const answers = [];
        for (const request of requests) {
          log.precached.push(request);
          const response = serve(request.url);
          if (!response.ok) {
            throw new TypeError("Antwort " + response.status + " für " + request.url);
          }
          answers.push([request.url, await response.text()]);
        }
        answers.forEach(([url, text]) => entries.set(url, text));
      },
      async match(request, matchOptions = {}) {
        const url = typeof request === "string" ? new URL(request, BASE).href : request.url;
        const key = matchOptions.ignoreSearch ? url.split("?")[0] : url;
        return entries.has(key) ? new Response(entries.get(key)) : undefined;
      },
    };
  }

  const caches = {
    async has(name) {
      return stores.has(name);
    },
    async open(name) {
      if (!stores.has(name)) {
        stores.set(name, new Map());
      }
      return cacheOf(stores.get(name));
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name) {
      return stores.delete(name);
    },
  };

  const self = {
    location: { href: BASE + "sw.js", origin: options.origin ?? new URL(BASE).origin },
    addEventListener: (type, listener) => {
      listeners[type] = listener;
    },
    clients: {
      claim: async () => {
        log.claim += 1;
      },
    },
    skipWaiting: () => {
      log.skipWaiting += 1;
    },
  };

  async function networkFetch(request) {
    log.fetched.push(request.url);
    if (options.offline) {
      throw new TypeError("Kein Netz");
    }
    return new Response("Netz: " + request.url);
  }

  vm.runInNewContext(WORKER_TEXT, {
    self,
    caches,
    URL,
    Response,
    Request: FakeRequest,
    fetch: networkFetch,
    console: { error: (text) => log.errors.push(text) },
  }, { filename: "sw.js" });

  async function extendable(type) {
    const waits = [];
    listeners[type]({ waitUntil: (promise) => waits.push(promise) });
    await Promise.all(waits);
  }

  return {
    log,
    stores,
    install: () => extendable("install"),
    activate: () => extendable("activate"),
    // Liefert das Versprechen aus respondWith oder null, wenn der Worker die Anfrage nicht beantwortet.
    request(path, init) {
      let answer = null;
      listeners.fetch({
        request: new FakeRequest(path, init),
        respondWith: (promise) => {
          answer = promise;
        },
      });
      return answer;
    },
    message(data, source) {
      listeners.message({ data, source });
    },
  };
}

async function installedWorker(options) {
  const worker = startWorker(options);
  await worker.install();
  worker.log.fetched.length = 0;
  return worker;
}

function pngSize(path) {
  const data = readFileSync(path);
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
}

// ----- Liste und Ordner -----

test("Jede Datei der App steht in PRECACHE_URLS", () => {
  const listed = new Set(precacheList());
  const missing = appFiles().filter((file) => !listed.has(file)).sort();
  assert.equal(missing.length, 0, "In PRECACHE_URLS fehlen " + missing.length + " Dateien: " + missing.join(", "));
});

test("Jeder Eintrag in PRECACHE_URLS gibt es als Datei", () => {
  const absent = precacheList().filter((entry) => entry !== "./" && !existsSync(join(ROOT, entry)));
  assert.equal(absent.length, 0, "Diese " + absent.length + " Einträge gibt es nicht als Datei: " + absent.join(", "));
});

test("PRECACHE_URLS ist relativ, ohne Dubletten und ohne Testseite und Tests", () => {
  const list = precacheList();
  assert.equal(new Set(list).size, list.length);
  for (const required of ["./", "index.html", "js/version.js"]) {
    assert.ok(list.includes(required), required);
  }
  for (const entry of list) {
    assert.ok(!entry.startsWith("/") && !entry.includes(".."), entry);
    assert.ok(!entry.startsWith("machbarkeit/") && !entry.startsWith("test/"), entry);
    assert.ok(!entry.split("/").some((part) => part.startsWith("_")), entry);
  }
});

test("sw.js und js/version.js tragen dieselbe Version, jede in einer eigenen Zeile", () => {
  assert.match(VERSION_TEXT, /^export const VERSION = "\d+\.\d+\.\d+";\r?$/m);
  const workerLine = 'const VERSION = "' + VERSION + '";';
  assert.ok(WORKER_TEXT.split(/\r?\n/).includes(workerLine), "In sw.js fehlt die Zeile " + workerLine);
});

// ----- Installation -----

test("Die Installation legt alles in den eigenen Cache, am HTTP-Cache vorbei", async () => {
  const worker = await installedWorker();
  const list = precacheList();
  assert.deepEqual(worker.log.precached.map((request) => request.url), list.map((entry) => new URL(entry, BASE).href));
  assert.ok(worker.log.precached.every((request) => request.cache === "reload"));
  assert.deepEqual([...worker.stores.keys()], [CACHE_NAME]);
  assert.equal(worker.stores.get(CACHE_NAME).size, list.length);
  assert.deepEqual(worker.log.errors, []);
});

test("Weicht js/version.js im Cache ab, scheitert die Installation und ihr Cache verschwindet", async () => {
  const worker = startWorker({
    existingCaches: [CACHE_PREFIX + "0.0.1"],
    versionText: 'export const VERSION = "0.0.1";\n',
  });
  await assert.rejects(worker.install(), /Versionsprüfung/);
  assert.deepEqual([...worker.stores.keys()], [CACHE_PREFIX + "0.0.1"]);
  assert.equal(worker.log.errors.length, 1);
});

test("Scheitert die Versionsprüfung, bleibt ein Cache, den ein Worker derselben Version nutzt", async () => {
  const worker = startWorker({
    existingCaches: [CACHE_NAME],
    versionText: 'export const VERSION = "0.0.1";\n',
  });
  await assert.rejects(worker.install(), /Versionsprüfung/);
  assert.ok(worker.stores.has(CACHE_NAME));
  assert.equal(worker.log.errors.length, 1);
});

test("Fehlt eine Datei auf dem Server, scheitert die Installation", async () => {
  const worker = startWorker({ missing: ["daten/mrt.json"] });
  await assert.rejects(worker.install(), /daten\/mrt\.json/);
  assert.equal(worker.stores.get(CACHE_NAME).size, 0);
});

test("Der neue Worker wartet: kein skipWaiting bei Installation und Aktivierung", async () => {
  const worker = await installedWorker();
  await worker.activate();
  assert.equal(worker.log.skipWaiting, 0);
});

// ----- Aktivierung -----

test("activate löscht nur alte eigene Caches, nie die der Testseite", async () => {
  const keep = ["radiology-english.machbarkeit.0.1.2", "fremder-cache"];
  const worker = await installedWorker({ existingCaches: [CACHE_PREFIX + "0.0.1", CACHE_PREFIX + "0.8.0", ...keep] });
  await worker.activate();
  assert.deepEqual([...worker.stores.keys()].sort(), [CACHE_NAME, ...keep].sort());
  assert.equal(worker.log.claim, 1);
});

// ----- Anfragen -----

test("Cache zuerst: Was im Cache liegt, kommt ohne Netz, auch mit Suchstring", async () => {
  const worker = await installedWorker();
  for (const path of ["index.html", "index.html?a=1", "./", "daten/mrt.json"]) {
    const response = await worker.request(path);
    assert.match(await response.text(), /^Inhalt von /, path);
  }
  assert.deepEqual(worker.log.fetched, []);
});

test("Dann das Netz: Was nicht im Cache liegt, kommt vom Server", async () => {
  const worker = await installedWorker();
  const response = await worker.request("gibt-es-nicht-im-cache.txt");
  assert.equal(await response.text(), "Netz: " + BASE + "gibt-es-nicht-im-cache.txt");
  assert.deepEqual(worker.log.fetched, [BASE + "gibt-es-nicht-im-cache.txt"]);
});

test("Ohne Netz bekommt ein Seitenaufruf die index.html, alles andere die Antwort 503", async () => {
  const worker = await installedWorker({ offline: true });
  const page = await worker.request("irgendeine-seite", { mode: "navigate" });
  assert.equal(await page.text(), "Inhalt von index.html");
  const other = await worker.request("nicht-im-cache.png");
  assert.equal(other.status, 503);
  assert.match(await other.text(), /nicht-im-cache\.png/);
});

test("Die Testseite wird nur durchgeleitet und bekommt nie die App-Seite", async () => {
  const online = await installedWorker();
  const passed = await online.request("machbarkeit/index.html", { mode: "navigate" });
  assert.equal(await passed.text(), "Netz: " + BASE + "machbarkeit/index.html");

  const offline = await installedWorker({ offline: true });
  const failed = await offline.request("machbarkeit/index.html", { mode: "navigate" });
  assert.equal(failed.status, 503);
});

test("Fremde Anfragen beantwortet der Worker nicht", async () => {
  const worker = await installedWorker();
  assert.equal(worker.request("index.html", { method: "POST" }), null);
  assert.equal(worker.request("file:///anderes-projekt/index.html"), null);
  const foreignOrigin = await installedWorker({ origin: "anderer-ursprung" });
  assert.equal(foreignOrigin.request("index.html"), null);
});

// ----- Nachrichten -----

test("skipWaiting nur auf Aufforderung der Seite", () => {
  const worker = startWorker();
  worker.message({ type: "skipWaiting" });
  assert.equal(worker.log.skipWaiting, 1);
});

test("getVersion wird beantwortet, Unbekanntes bleibt ohne Folgen", () => {
  const worker = startWorker();
  const answers = [];
  worker.message({ type: "getVersion" }, { postMessage: (data) => answers.push(data) });
  assert.equal(answers.length, 1);
  assert.equal(answers[0].type, "version");
  assert.equal(answers[0].version, VERSION);
  worker.message({ type: "getVersion" }, null);
  for (const data of [null, undefined, 5, "skipWaiting", {}, { type: "gibt-es-nicht" }]) {
    worker.message(data, null);
  }
  assert.equal(worker.log.skipWaiting, 0);
});

// ----- Hülle -----

test("package.json enthält nur das Vereinbarte", () => {
  assert.deepEqual(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")), {
    name: "radiology-english",
    private: true,
    type: "module",
  });
});

test("Das Manifest nennt die App, relative Pfade und vorhandene Symbole", () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.webmanifest"), "utf8"));
  assert.equal(manifest.name, "Radiology English");
  assert.equal(manifest.short_name, "Rad English");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.background_color, "#141416");
  assert.deepEqual(manifest.icons.map((icon) => icon.sizes), ["180x180", "192x192", "512x512"]);
  for (const icon of manifest.icons) {
    assert.ok(!icon.src.startsWith("/"), icon.src);
    const [width, height] = pngSize(join(ROOT, icon.src));
    assert.equal(width + "x" + height, icon.sizes, icon.src);
  }
});

test("js/core greift nicht auf Browser-Objekte zu", () => {
  for (const name of readdirSync(join(ROOT, "js", "core"))) {
    const code = readFileSync(join(ROOT, "js", "core", name), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    for (const word of ["window", "document", "localStorage", "fetch", "navigator"]) {
      assert.ok(!new RegExp("\\b" + word + "\\b").test(code), name + " nutzt " + word);
    }
  }
});
