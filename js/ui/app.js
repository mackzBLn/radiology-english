/*
 * Start der App: Lernstand, Sprachausgabe, Router, Service Worker und Fehlerkarte.
 * Statisch geladen wird nur, was der Start braucht. Ansichten lädt der Router, Inhaltsdaten erst getContent().
 * Quellen:
 *   https://developer.mozilla.org/en-US/docs/Web/API/Window/error_event
 *   https://developer.mozilla.org/en-US/docs/Web/API/Window/unhandledrejection_event
 *   https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist
 *   https://developer.mozilla.org/en-US/docs/Web/API/Location/reload
 */

import { VERSION } from "../version.js";
import { toDateString } from "../core/dates.js";
import { createStore, unreadableError } from "../core/storage.js";
import { createTts } from "../speech/tts.js";
import { button, card, copyButton } from "./components.js";
import { el } from "./dom.js";
import { createRouter } from "./router.js";
import { createWorkerControl } from "./worker-control.js";

// Alle Module sind geladen. Ab hier zeigt Fehler die Fehlerkarte, nicht mehr der Hinweis aus index.html.
window.removeEventListener("error", window.startFailed);

// ---------- Fehlerkarte: Der Lernstand bleibt, nichts wird irgendwohin geschickt. ----------

const ERROR_LIMIT = 5;
const errorTexts = [];
let router = null;

function describeError(error) {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const head = error.name + ": " + error.message;
  const stack = String(error.stack ?? "");
  return stack.startsWith(head) ? stack : (head + "\n" + stack).trim();
}

function showErrorCard(error) {
  const text = describeError(error);
  if (!errorTexts.includes(text)) {
    errorTexts.push(text);
    errorTexts.splice(0, Math.max(0, errorTexts.length - ERROR_LIMIT));
  }
  const report = errorTexts.join("\n\n") + "\n\nVersion " + VERSION;

  function close() {
    errorTexts.length = 0;
    layer.remove();
  }

  document.querySelector(".error-layer")?.remove();
  const layer = el(
    "div",
    { class: "error-layer", role: "alert" },
    card(
      { class: "card-error" },
      el("h2", null, "Da ist etwas schiefgelaufen"),
      el("p", null, "Dein Lernstand bleibt erhalten. Nichts wird irgendwohin geschickt."),
      el("pre", { class: "pre-text" }, report),
      copyButton(() => report),
      router
        ? button("Zur Startseite", () => {
            close();
            router.navigate("#/");
          }, { kind: "primary" })
        : null,
      // Die Home-Bildschirm-App hat keinen Knopf zum Neuladen.
      button("App neu laden", () => window.location.reload()),
      button("Schließen", close),
    ),
  );
  document.body.append(layer);
}

window.addEventListener("error", (event) => showErrorCard(event.error ?? event.message));
window.addEventListener("unhandledrejection", (event) => showErrorCard(event.reason));

// ---------- Inhaltsdaten: erst laden, wenn eine Ansicht sie braucht. ----------

async function fetchJson(name) {
  const response = await fetch("daten/" + name + ".json");
  if (!response.ok) {
    throw new Error("Inhaltsdatei " + name + " nicht geladen, Status " + response.status);
  }
  return response.json();
}

let contentPromise = null;

function getContent() {
  if (!contentPromise) {
    contentPromise = import("../core/content.js")
      .then(({ loadContent }) => loadContent(fetchJson))
      .catch((error) => {
        contentPromise = null; // der nächste Aufruf versucht es neu
        throw error;
      });
  }
  return contentPromise;
}

// ---------- Start ----------

const store = createStore(window.localStorage);
const loaded = store.load();

// Eine Übung aus einer anderen App-Version wird verworfen, der Lernstand bleibt (Vorgabe).
// Wirft dabei der Speicher, läuft die App weiter, und die Startseite zeigt den Hinweis.
function discardForeignSession() {
  try {
    const session = store.loadSession();
    if (session && session.appVersion !== VERSION) {
      store.clearSession();
    }
    return null;
  } catch (cause) {
    return unreadableError(cause);
  }
}

const sessionError = discardForeignSession();
const now = () => new Date();

const ctx = {
  state: loaded.state,
  loadError: loaded.error ?? sessionError,
  store,
  version: VERSION,
  worker: createWorkerControl(),
  tts: createTts(undefined, { getSettings: () => ctx.state.settings }),
  getContent,
  now,
  today: () => toDateString(now()),
  save: () => store.save(ctx.state),
  replaceState(state) {
    ctx.state = state;
  },
  navigate: (hash) => router.navigate(hash),
  back: () => router.back(),
};

router = createRouter({ container: document.getElementById("app"), ctx, onError: showErrorCard });

router.start().finally(() => {
  ctx.worker.register();
  navigator.storage?.persist?.()?.catch(() => {
    // Ohne dauerhaften Speicher läuft die App weiter. Der Technik-Bericht zeigt den Stand.
  });
});
