/*
 * Router über den Adressteil nach dem #. Jede Ansicht wird erst beim Aufruf geladen.
 * Quellen:
 *   https://developer.mozilla.org/en-US/docs/Web/API/Window/hashchange_event
 *   https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import
 *   https://developer.mozilla.org/en-US/docs/Web/API/History/state
 *   https://developer.mozilla.org/en-US/docs/Web/API/History/replaceState
 *   https://developer.mozilla.org/en-US/docs/Web/API/History/scrollRestoration
 *   https://developer.mozilla.org/en-US/docs/Web/API/Element/replaceChildren
 */

import { el } from "./dom.js";
import { renderComingSoon, viewHeader } from "./components.js";

const HOME = "#/";

// parent: Ziel von Zurück, wenn es keinen früheren Schritt in der App gibt, etwa nach einem Neustart. Vorgabe ist die Startseite.
const ROUTES = [
  { name: "home", path: [], view: "home" },
  { name: "path", path: ["pfad"], view: "path" },
  { name: "section", path: ["abschnitt", ":id"], view: "section", parent: "#/pfad" },
  { name: "train", path: ["bahn"], view: "train" },
  { name: "train", path: ["bahn", ":focus"], view: "train" },
  { name: "speak", path: ["sprechen"], view: "speak" },
  { name: "speak", path: ["sprechen", ":focus"], view: "speak" },
  { name: "partner", path: ["partner"], view: "partner" },
  { name: "partner", path: ["partner", ":caseId", ":role"], view: "partner", parent: "#/partner" },
  { name: "progress", path: ["fortschritt"], view: "progress" },
  { name: "placement", path: ["einstufung"], view: "placement" },
  { name: "backup", path: ["sichern"], view: "backup" },
  { name: "settings", path: ["einstellungen"], view: "settings" },
];

function decodePart(part) {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

function normalizeHash(hash) {
  return hash === "" || hash === "#" ? HOME : hash;
}

export function parseRoute(hash) {
  const text = String(hash ?? "").replace(/^#\/?/, "").replace(/\/+$/, "");
  const parts = text === "" ? [] : text.split("/").map(decodePart);
  for (const route of ROUTES) {
    if (route.path.length !== parts.length) {
      continue;
    }
    const params = {};
    const matches = route.path.every((piece, index) => {
      if (piece.startsWith(":")) {
        params[piece.slice(1)] = parts[index];
        return parts[index] !== "";
      }
      return piece === parts[index];
    });
    if (matches) {
      return {
        name: route.name,
        view: route.view,
        parent: route.view === "home" ? null : route.parent ?? HOME,
        params,
      };
    }
  }
  return { name: "unknown", view: null, parent: HOME, params: {} };
}

// routeHash("abschnitt", id) ergibt #/abschnitt/<id>, die Teile werden für die Adresse kodiert.
export function routeHash(...parts) {
  return HOME + parts.map(encodeURIComponent).join("/");
}

function addBackIfMissing(host, ctx) {
  if (!host.querySelector("[data-back]")) {
    host.prepend(viewHeader(ctx));
  }
}

export function createRouter({
  container,
  ctx,
  onError,
  win = globalThis.window,
  importView = (name) => import("./views/" + name + ".js"),
  createHost = () => el("div", { class: "view" }),
  ensureBack = addBackIfMissing,
  comingSoon = renderComingSoon,
}) {
  let token = 0; // nur der neueste Aufruf darf die Seite ändern
  let cleanup = null;
  let depth = 0; // Schritte seit dem Start der App; steht auch im Verlauf, damit es ein Neuladen übersteht
  let started = false;
  let restoreScroll = 0;
  const scrollByDepth = new Map();

  function safely(action) {
    try {
      action();
    } catch (error) {
      onError(error);
    }
  }

  function runCleanup() {
    if (cleanup) {
      const previous = cleanup;
      cleanup = null;
      safely(previous);
    }
  }

  // Ein neuer Schritt hat noch keinen Eintrag im Verlauf. Ein Schritt zurück findet seinen alten wieder.
  function trackDepth() {
    const stored = win.history.state?.depth;
    if (Number.isInteger(stored)) {
      depth = stored;
      restoreScroll = scrollByDepth.get(stored) ?? 0;
      return;
    }
    depth = started ? depth + 1 : 0;
    restoreScroll = 0;
    win.history.replaceState({ ...win.history.state, depth }, "");
  }

  async function render() {
    token += 1;
    const current = token;
    const scrollTarget = restoreScroll;
    restoreScroll = 0;
    runCleanup();
    ctx.tts?.cancel();
    const route = parseRoute(win.location.hash);

    let module = null;
    if (route.view) {
      try {
        module = await importView(route.view);
      } catch (error) {
        // Jede bekannte Route hat ihre Ansicht. Lässt sie sich nicht laden, ist das ein echter Fehler: Die Fehlerkarte zeigt ihn.
        if (current === token) {
          onError(error);
        }
        return;
      }
      if (current !== token) {
        return;
      }
    }

    const host = createHost(); // Ein neuer Behälter: Was eine verlassene Ansicht noch anhängt, bleibt unsichtbar.
    container.replaceChildren(host);
    win.scrollTo(0, 0);
    if (!module) {
      // Nur eine unbekannte Route kommt hierher.
      safely(() => comingSoon(host, ctx));
      return;
    }
    try {
      const result = await module.render(host, ctx, route.params);
      if (current !== token) {
        if (typeof result === "function") {
          safely(result);
        }
        return;
      }
      cleanup = typeof result === "function" ? result : null;
      if (route.view !== "home") {
        ensureBack(host, ctx);
      }
      if (scrollTarget > 0) {
        win.scrollTo(0, scrollTarget);
      }
    } catch (error) {
      if (current === token) {
        onError(error);
      }
    }
  }

  function onHashChange() {
    scrollByDepth.set(depth, win.scrollY ?? 0);
    trackDepth();
    render();
  }

  // replace: Der laufende Schritt verlässt den Verlauf, Zurück führt nicht mehr dorthin. Die Tiefe bleibt.
  // replaceState löst kein hashchange aus, darum zeichnet navigate dann selbst.
  function navigate(hash, { replace = false } = {}) {
    if (normalizeHash(win.location.hash) === normalizeHash(hash)) {
      render();
    } else if (replace) {
      win.history.replaceState({ ...win.history.state }, "", hash);
      render();
    } else {
      win.location.hash = hash;
    }
  }

  // Ohne früheren Schritt, etwa nach einem Neustart, täte history.back nichts. Dann gilt das feste Ziel der Route.
  // Es ersetzt den Eintrag, die Tiefe bleibt 0. Ein neuer Eintrag führte beim nächsten Zurück wieder hierher, im Kreis.
  // replaceState löst kein hashchange aus, darum zeichnet back selbst.
  function back() {
    if (depth > 0) {
      win.history.back();
      return;
    }
    const parent = parseRoute(win.location.hash).parent ?? HOME;
    win.history.replaceState({ ...win.history.state, depth: 0 }, "", parent);
    render();
  }

  function start() {
    if ("scrollRestoration" in win.history) {
      win.history.scrollRestoration = "manual";
    }
    trackDepth();
    started = true;
    win.addEventListener("hashchange", onHashChange);
    return render();
  }

  function stop() {
    win.removeEventListener("hashchange", onHashChange);
    token += 1;
    runCleanup();
  }

  return { start, stop, render, navigate, back };
}
