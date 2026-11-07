"use strict";

/*
 * Radiology English: Service Worker der App. Klassisches Skript ohne import und export, Muster ist machbarkeit/sw.js.
 * Dort stehen auch die Lesedaten der Quellen; "Quelle N" verweist auf die Quellenlisten des Projekts.
 *  [S1]  https://developer.mozilla.org/en-US/docs/Web/API/Request/cache
 *  [S2]  https://developer.mozilla.org/en-US/docs/Web/API/Cache/addAll
 *  [S3]  https://developer.mozilla.org/en-US/docs/Web/API/CacheStorage/open
 *  [S4]  https://developer.mozilla.org/en-US/docs/Web/API/CacheStorage/keys
 *  [S5]  https://developer.mozilla.org/en-US/docs/Web/API/Clients/claim
 *  [S6]  https://developer.mozilla.org/en-US/docs/Web/API/ExtendableEvent/waitUntil
 *  [S7]  https://developer.mozilla.org/en-US/docs/Web/API/FetchEvent/respondWith
 *  [S8]  https://developer.mozilla.org/en-US/docs/Web/API/Cache/match
 *  [S9]  https://developer.mozilla.org/en-US/docs/Web/API/Request/mode
 *  [S10] https://developer.mozilla.org/en-US/docs/Web/API/Request/method
 *  [S11] https://developer.mozilla.org/en-US/docs/Web/API/Response/Response
 *  [S12] https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/message_event
 *  [S13] https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/skipWaiting
 *  [S14] https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope/location
 *  [S15] https://developer.mozilla.org/en-US/docs/Web/API/URL/origin
 *  [S16] https://developer.mozilla.org/en-US/docs/Web/API/ExtendableMessageEvent
 *  [S17] https://developer.mozilla.org/en-US/docs/Web/API/Response/text
 *  [S18] https://developer.mozilla.org/en-US/docs/Web/API/CacheStorage/delete
 *  [S19] https://developer.mozilla.org/en-US/docs/Web/API/CacheStorage/has
 */

// Dieselbe Nummer wie in js/version.js. Nummer und Liste setzt nur die Sitzung.
const VERSION = "0.9.2";

// Ein eigener Cache je Version. Die Testseite nutzt eine andere Vorsilbe, ihr Cache bleibt unberührt.
const CACHE_PREFIX = "radiology-english.app.";
const CACHE_NAME = CACHE_PREFIX + VERSION;

// Bereich = Ordner dieses Skripts (Quelle 40); self.location.href ist die Adresse des Skripts [S14].
const SCOPE_PATH = new URL("./", self.location.href).pathname;
const TEST_PAGE_PATH = SCOPE_PATH + "machbarkeit/";

// Relative Pfade, denn die App liegt im Unterordner (Quelle 11).
const PRECACHE_URLS = [
  // PRECACHE-START
  "./",
  "css/app.css",
  "daten/ct.json",
  "daten/einstufung.json",
  "daten/faelle.json",
  "daten/gemeinsam.json",
  "daten/klaeren.json",
  "daten/mrt.json",
  "daten/quellen.json",
  "daten/roentgen.json",
  "daten/satzbau.json",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "index.html",
  "js/core/backup.js",
  "js/core/content.js",
  "js/core/dates.js",
  "js/core/matcher.js",
  "js/core/migrate.js",
  "js/core/normalize.js",
  "js/core/partner.js",
  "js/core/placement.js",
  "js/core/planner.js",
  "js/core/speak-flow.js",
  "js/core/srs.js",
  "js/core/state.js",
  "js/core/storage.js",
  "js/core/train-run.js",
  "js/speech/assessor.js",
  "js/speech/recognizer.js",
  "js/speech/tts.js",
  "js/ui/app.js",
  "js/ui/components.js",
  "js/ui/dom.js",
  "js/ui/router.js",
  "js/ui/speak-step.js",
  "js/ui/views/backup.js",
  "js/ui/views/home.js",
  "js/ui/views/partner.js",
  "js/ui/views/path.js",
  "js/ui/views/placement.js",
  "js/ui/views/progress.js",
  "js/ui/views/section.js",
  "js/ui/views/settings.js",
  "js/ui/views/speak.js",
  "js/ui/views/train.js",
  "js/ui/worker-control.js",
  "js/version.js",
  "manifest.webmanifest",
  // PRECACHE-END
];

// Diese Datei im Cache muss die Zeichenfolge enthalten, mit der sie ihre Konstante VERSION setzt.
const VERSION_CHECK_URL = "js/version.js";
const VERSION_MARKER = "VERSION = \"" + VERSION + "\"";

self.addEventListener("install", (event) => {
  // Scheitert das Versprechen, wird dieser Worker verworfen, der bisherige läuft weiter [S6].
  event.waitUntil(precache());
});

async function precache() {
  try {
    // Gibt es den Cache schon [S19], kann ihn ein Worker derselben Version nutzen. Er bleibt, auch wenn diese Installation scheitert.
    const cacheInUse = await caches.has(CACHE_NAME);
    const cache = await caches.open(CACHE_NAME); // legt den Cache bei Bedarf an [S3]
    // cache: "reload" holt vom Server, ohne vorher im HTTP-Cache nachzusehen [S1], sonst landet die bis zu 600 s
    // alte Fassung von GitHub Pages im Cache (Quelle 32). addAll scheitert bei einer Antwort außerhalb von 200 bis 299 [S2].
    await cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: "reload" })));
    await checkCachedVersion(cache, cacheInUse);
  } catch (error) {
    console.error("Service Worker " + VERSION + ", Installation abgebrochen: " + error);
    throw error;
  }
}

// Geprüft wird die Datei im eigenen Cache, also das, was dieser Worker später ausliefert:
// GitHub Pages kann nach dem Hochladen noch die alte Datei liefern (Quellen 10 und 32).
async function checkCachedVersion(cache, cacheInUse) {
  let problem = "";
  const cached = await cache.match(VERSION_CHECK_URL, { ignoreVary: true }); // ohne Treffer undefined [S8]
  if (!cached) {
    problem = VERSION_CHECK_URL + " fehlt im Cache";
  } else if (!(await cached.text()).includes(VERSION_MARKER)) { // text() liest die Antwort als UTF-8 [S17]
    problem = VERSION_CHECK_URL + " im Cache enthält nicht " + VERSION_MARKER;
  }
  if (problem) {
    if (!cacheInUse) {
      await caches.delete(CACHE_NAME); // [S18]
    }
    throw new Error("Versionsprüfung nicht bestanden: " + problem);
  }
}

// Kein automatisches skipWaiting: Ein neuer Worker wartet, bis die Seite es schickt (Vorgabe des Projekts).

self.addEventListener("activate", (event) => {
  event.waitUntil(cleanUpAndClaim());
});

async function cleanUpAndClaim() {
  const keys = await caches.keys(); // alle Cache-Namen [S4]
  await Promise.all(
    keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key))
  );
  // Macht diesen Worker zum Controller aller Seiten im Bereich (Quelle 31, [S5]).
  await self.clients.claim();
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  // Nur GET [S10] und nur Anfragen im eigenen Ursprung [S15] und Bereich.
  if (request.method !== "GET") {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE_PATH)) {
    return;
  }
  event.respondWith(cacheFirst(request, url)); // ersetzt die Standardbehandlung [S7]
});

async function cacheFirst(request, url) {
  const cache = await caches.open(CACHE_NAME);
  // match ignoriert hier Suchstring und Vary-Kopfzeile und liefert ohne Treffer undefined [S8].
  const cached = await cache.match(request, { ignoreSearch: true, ignoreVary: true });
  if (cached) {
    return cached;
  }
  try {
    return await fetch(request);
  } catch (error) {
    // Ohne Netz bekommt ein Seitenaufruf [S9] die gespeicherte index.html. Die Testseite wird nur durchgeleitet.
    if (request.mode === "navigate" && !url.pathname.startsWith(TEST_PAGE_PATH)) {
      const page = await cache.match("index.html");
      if (page) {
        return page;
      }
    }
    return new Response("Ohne Netz und nicht im Cache: " + url.pathname, { // Status und Kopfzeilen [S11]
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

self.addEventListener("message", (event) => {
  const data = event.data; // ExtendableMessageEvent mit data und source [S12, S16]
  if (!data || typeof data !== "object") {
    return;
  }
  if (data.type === "getVersion") {
    if (event.source) {
      event.source.postMessage({ type: "version", version: VERSION });
    }
  } else if (data.type === "skipWaiting") {
    self.skipWaiting(); // macht den wartenden Worker zum aktiven [S13], nur auf diese Aufforderung der Seite
  }
});
