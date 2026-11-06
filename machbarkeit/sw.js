"use strict";

/*
 * Radiology English – Machbarkeitstest: Service Worker der Testseite.
 * Klassisches Skript ohne import und export und ohne Nachladen weiterer Skripte, damit node --check es prüfen kann
 * (Syntaxprüfung ohne Ausführung [N1]).
 *
 * Quellen: "Quelle N" verweist auf die Quellenlisten des Projekts. Die Adressen [N1] und [S1] bis [S16]
 * wurden am 03.11.2026 gelesen (Node-Doku, MDN Web Docs), [S17] bis [S23] am 06.11.2026 (MDN Web Docs);
 * [S2], [S6] und [S8] sowie Quelle 31 wurden am 06.11.2026 erneut gelesen.
 *  [N1]  https://nodejs.org/api/cli.html (Option -c, --check)
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
 *  [S19] https://developer.mozilla.org/en-US/docs/Web/API/console/error_static
 *  [S20] https://developer.mozilla.org/en-US/docs/Web/API/Clients/matchAll
 *  [S21] https://developer.mozilla.org/en-US/docs/Web/API/Client/postMessage
 *  [S22] https://developer.mozilla.org/en-US/docs/Web/API/Client/url
 *  [S23] https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/includes
 */

// Version des Service Workers; die Seite (test.js) trägt dieselbe Konstante und zeigt beide an.
// Jede Version hat einen eigenen Cache-Namen (Vorgabe des Projekts), darum steigt sie bei jeder Änderung an dieser Datei.
const VERSION = "0.1.2";

// Ein eigener Cache-Name je Version; alte Caches mit dieser Vorsilbe löscht activate (Vorgabe des Projekts).
const CACHE_PREFIX = "radiology-english.machbarkeit.";
const CACHE_NAME = CACHE_PREFIX + VERSION;

// Bereich = Ordner dieses Skripts (Quelle 40); self.location.href ist die Adresse des Skripts [S14].
const SCOPE_PATH = new URL("./", self.location.href).pathname;

// Relative Pfade, denn die Seite liegt als Projektseite im Unterordner (Quelle 11).
const PRECACHE_URLS = ["./", "index.html", "test.js"];

// Versionsprüfung: Diese gecachte Datei muss die Zeichenfolge enthalten, mit der test.js ihre Konstante VERSION setzt.
const VERSION_CHECK_URL = "test.js";
const VERSION_MARKER = "VERSION = \"" + VERSION + "\"";

self.addEventListener("install", (event) => {
  // waitUntil hält die Installation offen; scheitert das Versprechen, wird der Worker verworfen [S6].
  event.waitUntil(precache());
});

async function precache() {
  try {
    // open legt den Cache bei Bedarf an [S3].
    const cache = await caches.open(CACHE_NAME);
    // cache: "reload" holt vom Server, ohne vorher im HTTP-Cache nachzusehen, und legt die Antwort danach dort ab [S1].
    // So landet nicht die bis zu 600 s alte Fassung von GitHub Pages (Quelle 32) im Cache des Service Workers.
    // addAll nimmt Request-Objekte an und scheitert bei einer Antwort außerhalb von 200 bis 299 [S2].
    await cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: "reload" })));
    await checkCachedVersion(cache);
    await reportInstall(true, VERSION_CHECK_URL + " im Cache enthält " + VERSION_MARKER);
  } catch (error) {
    const text = String(error);
    // Fehler und Ursache in die Konsole [S19] und, weil die Seite die Konsole nicht sieht, als Meldung an die Seite.
    console.error("Service Worker " + VERSION + ", Installation abgebrochen: " + text);
    await reportInstall(false, text);
    // Das abgelehnte Versprechen lässt die Installation scheitern, der Worker wird verworfen [S6]. Der bisherige
    // Worker läuft weiter, denn ein neuer wird erst nach erfolgreicher Installation aktiv. Bei der nächsten
    // Navigation im Bereich holt der Browser sw.js erneut; weicht die Datei vom aktiven Worker ab, installiert er neu (Quelle 31).
    throw error;
  }
}

// Geprüft wird die Datei im eigenen Cache, also genau das, was dieser Worker später ausliefern würde: GitHub Pages
// kann nach dem Hochladen noch die alte test.js liefern (Quellen 10 und 32), und sie bliebe sonst dauerhaft unter der neuen Version liegen.
async function checkCachedVersion(cache) {
  let problem = "";
  try {
    // match nimmt eine URL als Zeichenkette und liefert ohne Treffer undefined; ignoreVary wie in cacheFirst [S8].
    const cached = await cache.match(VERSION_CHECK_URL, { ignoreVary: true });
    if (!cached) {
      problem = VERSION_CHECK_URL + " fehlt im Cache";
    } else if (!(await cached.text()).includes(VERSION_MARKER)) {
      // text() liest die Antwort als UTF-8 zu Ende [S17]; includes achtet auf Groß- und Kleinschreibung [S23].
      problem = VERSION_CHECK_URL + " im Cache enthält nicht " + VERSION_MARKER;
    }
  } catch (error) {
    problem = VERSION_CHECK_URL + " im Cache nicht lesbar (" + error + ")";
  }
  if (problem) {
    // delete löscht den Cache dieser Version und meldet, ob es ihn gab [S18].
    const deleted = await caches.delete(CACHE_NAME);
    throw new Error("Versionsprüfung nicht bestanden: " + problem + "; Cache " + CACHE_NAME +
      (deleted ? " gelöscht" : " nicht gefunden"));
  }
}

// Meldet den offenen Seiten im eigenen Bereich das Ergebnis der Installation. includeUncontrolled, denn dieser Worker
// steuert sie noch nicht [S20]; auf der Seite kommt die Meldung als message auf navigator.serviceWorker an [S21].
// Ob das unter iOS auch auf einer nicht gesteuerten Seite geschieht, ist offen; die Seite beobachtet darum zusätzlich den Zustand.
// Ein Fehler beim Melden ändert das Ergebnis der Installation nicht.
async function reportInstall(ok, detail) {
  try {
    const pages = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });
    pages
      // Gleicher Ursprung heißt nicht gleicher Bereich: Projektseiten teilen sich den Ursprung (Quelle 11); url der Seite [S22].
      .filter((page) => new URL(page.url).pathname.startsWith(SCOPE_PATH))
      .forEach((page) => page.postMessage({ type: "installResult", version: VERSION, ok: ok, detail: detail }));
  } catch (error) {
    console.error("Service Worker " + VERSION + ", Meldung an die Seiten fehlgeschlagen: " + error);
  }
}

// Kein automatisches skipWaiting: ein neuer Worker wartet, bis die Seite „Jetzt aktualisieren“ meldet (Vorgabe des Projekts).

self.addEventListener("activate", (event) => {
  event.waitUntil(cleanUpAndClaim());
});

async function cleanUpAndClaim() {
  // keys liefert alle Cache-Namen [S4]; gelöscht werden nur alte Caches mit eigener Vorsilbe, nie fremde.
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key))
  );
  // claim macht diesen Worker sofort zum Controller aller Seiten im Bereich (Quelle 31, [S5]).
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
  // respondWith ersetzt die Standardbehandlung durch das Versprechen auf eine Antwort [S7].
  event.respondWith(cacheFirst(request));
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  // Zuerst der Cache; match ignoriert hier Suchstring und Vary-Kopfzeile und liefert ohne Treffer undefined [S8].
  const cached = await cache.match(request, { ignoreSearch: true, ignoreVary: true });
  if (cached) {
    return cached;
  }
  try {
    return await fetch(request);
  } catch (error) {
    // Ohne Netz bekommt ein Seitenaufruf (mode "navigate" [S9]) die gespeicherte index.html.
    if (request.mode === "navigate") {
      const page = await cache.match("index.html");
      if (page) {
        return page;
      }
    }
    // Antwort mit Status und Kopfzeilen [S11].
    return new Response("Ohne Netz und nicht im Cache: " + new URL(request.url).pathname, {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
}

self.addEventListener("message", (event) => {
  // message trägt ein ExtendableMessageEvent mit data und source [S12, S16].
  const data = event.data;
  if (!data || typeof data !== "object") {
    return;
  }
  if (data.type === "getVersion") {
    if (event.source) {
      // Antwort an den Absender über Client.postMessage; die Seite hört auf navigator.serviceWorker [S12].
      event.source.postMessage({ type: "version", version: VERSION });
    }
  } else if (data.type === "skipWaiting") {
    // skipWaiting macht den wartenden Worker zum aktiven [S13]; nur auf diese Aufforderung der Seite.
    self.skipWaiting();
  }
});
