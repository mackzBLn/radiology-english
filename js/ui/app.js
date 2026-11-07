/*
 * Start der App: Lernstand, Sprachausgabe, Router, Service Worker und Fehlerkarte.
 * Statisch geladen wird nur, was der Start braucht. Ansichten lädt der Router, Inhaltsdaten erst getContent().
 * Quellen:
 *   https://developer.mozilla.org/en-US/docs/Web/API/Window/error_event
 *   https://developer.mozilla.org/en-US/docs/Web/API/Window/unhandledrejection_event
 *   https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist
 *   https://developer.mozilla.org/en-US/docs/Web/API/Location/reload
 *   https://developer.mozilla.org/en-US/docs/Web/API/Storage/setItem
 */

import { VERSION } from "../version.js";
import { toDateString } from "../core/dates.js";
import { createStore, discardForeignSession } from "../core/storage.js";
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

  // setItem scheitert, wenn der Speicher voll ist. Das Letzte steht dann noch nicht im Speicher, „bleibt erhalten“ stimmte dafür nicht.
  const storageFull = error?.name === "QuotaExceededError";

  document.querySelector(".error-layer")?.remove();
  const layer = el(
    "div",
    { class: "error-layer", role: "alert" },
    card(
      { class: "card-error" },
      el("h2", null, storageFull ? "Der Speicher ist voll" : "Da ist etwas schiefgelaufen"),
      el(
        "p",
        null,
        storageFull
          ? "Die letzte Antwort ist noch nicht gesichert. Lass die App offen und sichere deinen Lernstand als Datei. Nichts wird irgendwohin geschickt."
          : "Dein Lernstand bleibt erhalten. Nichts wird irgendwohin geschickt.",
      ),
      el("pre", { class: "pre-text" }, report),
      copyButton(() => report),
      router && storageFull
        ? button("Zu „Sichern“", () => {
            close();
            router.navigate("#/sichern");
          }, { kind: "primary" })
        : null,
      router && !storageFull
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

const foreign = discardForeignSession(store, VERSION);
const now = () => new Date();

const ctx = {
  state: loaded.state,
  loadError: loaded.error ?? foreign.error,
  // Ein angefangener Test ging mit dem Update verloren. Die Startseite sagt das einmal, sonst stünde sie still wieder am Anfang.
  placementDiscarded: foreign.discardedKind === "placement",
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
  navigate: (hash, options) => router.navigate(hash, options),
  back: () => router.back(),
};

router = createRouter({ container: document.getElementById("app"), ctx, onError: showErrorCard });

router.start().finally(() => {
  ctx.worker.register();
  navigator.storage?.persist?.()?.catch(() => {
    // Ohne dauerhaften Speicher läuft die App weiter. Der Technik-Bericht zeigt den Stand.
  });
});
