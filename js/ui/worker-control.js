/*
 * Service Worker von der Seite aus: anmelden, neue Version erkennen und auf Wunsch wechseln.
 * Ohne Zugriff auf die Seite, darum in Node mit nachgebauten Objekten testbar. Muster ist die Testseite, machbarkeit/test.js.
 * "Quelle N" verweist auf die Quellenlisten des Projekts.
 * Quellen:
 *   https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register
 *   https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/updateViaCache
 *   https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/update
 *   https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/installing
 *   https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/updatefound_event
 *   https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorker/statechange_event
 *   https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/controllerchange_event
 *   https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/message_event
 *   https://developer.mozilla.org/en-US/docs/Web/API/Clients/claim
 *   https://developer.mozilla.org/en-US/docs/Web/API/Worker/postMessage
 */

// Der neue Worker wartet, bis die Startseite auf „Jetzt aktualisieren“ gefragt hat. Neu geladen wird nur nach dieser Frage,
// denn auch die erste Installation meldet controllerchange, und mitten in einer Übung wechselt die Version nie.
export function createWorkerControl(
  container = globalThis.navigator?.serviceWorker,
  { reload = () => globalThis.location.reload() } = {},
) {
  const listeners = new Set();
  const followed = new WeakSet();
  let registration = null;
  let updateReady = false;
  let updateRequested = false;

  function announce() {
    updateReady = true;
    for (const listener of listeners) {
      listener();
    }
  }

  // Bedient schon ein Worker die Seite, ist ein fertig installierter der neue. Bei der ersten Installation gibt es keinen.
  function follow(worker) {
    if (followed.has(worker)) {
      return;
    }
    followed.add(worker);
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed" && container.controller) {
        announce();
      }
    });
  }

  function watch(found) {
    registration = found;
    if (found.waiting && container.controller) {
      announce();
    }
    // Läuft die Installation schon, wenn register auflöst, ist ihr updatefound vorbei.
    if (found.installing) {
      follow(found.installing);
    }
    found.addEventListener("updatefound", () => {
      if (found.installing) {
        follow(found.installing);
      }
    });
  }

  function register() {
    if (!container) {
      return;
    }
    container.addEventListener("controllerchange", () => {
      if (updateRequested) {
        reload();
      }
    });
    // updateViaCache "none": sw.js kommt nie aus dem HTTP-Cache, denn GitHub Pages liefert max-age=600 (Quelle 32).
    container.register("sw.js", { updateViaCache: "none" }).then(watch).catch(() => {
      // Ohne Worker läuft die App weiter, nur nicht ohne Netz. Der Technik-Bericht zeigt das.
    });
  }

  // Für die Startseite: Eine App, die nur aus dem Hintergrund zurückkommt, ruft keine Seite neu auf, also prüft sonst nichts.
  function checkForUpdate() {
    registration?.update().catch(() => {
      // Ohne Netz bleibt es bei der laufenden Version.
    });
  }

  function applyUpdate() {
    const waiting = registration?.waiting;
    if (waiting) {
      updateRequested = true;
      waiting.postMessage({ type: "skipWaiting" });
    }
  }

  // Version des Workers, der diese Seite gerade bedient, oder null.
  function version() {
    const active = container?.controller;
    if (!active) {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      const finish = (value) => {
        clearTimeout(timer);
        container.removeEventListener("message", onMessage);
        resolve(value);
      };
      const onMessage = (event) => {
        if (event.data?.type === "version") {
          finish(event.data.version);
        }
      };
      const timer = setTimeout(() => finish(null), 1500);
      container.addEventListener("message", onMessage);
      active.postMessage({ type: "getVersion" });
    });
  }

  return {
    register,
    checkForUpdate,
    applyUpdate,
    version,
    isUpdateReady: () => updateReady,
    onUpdateReady(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
