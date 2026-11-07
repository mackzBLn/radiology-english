/*
 * Lernstand im Speicher des Geräts. backend ist ein Objekt wie localStorage.
 * Die Uhr ist ein Parameter, die Vorgabe ist die Gerätezeit.
 * Quellen:
 *   https://developer.mozilla.org/en-US/docs/Web/API/Storage
 *   https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause
 */

import { createState, quarantineBrokenUnits, stateProblem } from "./state.js";
import { BrokenStateError, FormatTooNewError, migrate } from "./migrate.js";

const PREFIX = "radiology-english.app.";

export const STORAGE_KEYS = {
  state: PREFIX + "state",
  broken: PREFIX + "state.broken",
  previous: PREFIX + "previous",
  session: PREFIX + "session",
};

// Eigener Schlüssel: Die Läufe ohne erkannten Text gehören nicht zum Lernstand und nicht in die Sicherung.
const SPEECH_LOG_KEY = PREFIX + "speechLog";
const SPEECH_LOG_LIMIT = 20;

function loadError(code, messageDe, cause) {
  const error = new Error(messageDe, { cause });
  error.code = code;
  return error;
}

// Auch für alles, was den Speicher beim Start sonst noch liest.
export function unreadableError(cause) {
  return loadError(
    "unavailable",
    "Der Speicher des Geräts lässt sich gerade nicht lesen. Lade die App neu. Dein Lernstand wird nicht überschrieben.",
    cause,
  );
}

/*
 * Eine Übung aus einer anderen App-Version wird verworfen, der Lernstand bleibt (Vorgabe). discardedKind nennt ihre Art, damit die Startseite es sagen kann.
 * Wirft dabei der Speicher, läuft die App weiter, und die Startseite zeigt den Hinweis.
 */
export function discardForeignSession(store, version) {
  try {
    const session = store.loadSession();
    if (session && session.appVersion !== version) {
      store.clearSession();
      return { error: null, discardedKind: session.kind ?? null };
    }
    return { error: null, discardedKind: null };
  } catch (cause) {
    return { error: unreadableError(cause), discardedKind: null };
  }
}

function errorForStoredState(cause) {
  if (cause instanceof FormatTooNewError) {
    return loadError(
      "tooNew",
      "Der gespeicherte Lernstand stammt aus einer neueren Version der App. Er bleibt unverändert. Aktualisiere die App, bis dahin speichert sie nichts.",
      cause,
    );
  }
  return loadError(
    "broken",
    "Der gespeicherte Lernstand ist beschädigt. Die Rohdaten bleiben aufgehoben, unter „Sichern“ kannst du sie als Datei ablegen. Die App beginnt mit einem neuen Stand.",
    cause,
  );
}

export function createStore(backend, { now = () => new Date(), migrations, target } = {}) {
  // Rohdaten, die noch nicht unter …state.broken liegen. Solange es sie gibt, überschreibt save den Stand nicht.
  let pendingBroken = null;
  // load konnte den Speicher nicht lesen. Was dort liegt, ist unbekannt und darf nicht einfach überschrieben werden.
  let readFailed = false;
  // Der Fehler zu einem Stand aus einer neueren Version. Solange es ihn gibt, schreibt save nichts.
  let saveBlockedBy = null;

  // Eine ältere, andere Rohfassung rückt auf eine freie Nummer, damit auch sie erhalten bleibt.
  function preserveBroken(text) {
    const existing = backend.getItem(STORAGE_KEYS.broken);
    if (existing != null && existing !== text) {
      let number = 1;
      while (backend.getItem(STORAGE_KEYS.broken + "." + number) != null) {
        number += 1;
      }
      backend.setItem(STORAGE_KEYS.broken + "." + number, existing);
    }
    backend.setItem(STORAGE_KEYS.broken, text);
  }

  function keepBroken(text) {
    pendingBroken = text;
    try {
      preserveBroken(text);
      pendingBroken = null;
    } catch {
      // Bleibt vorgemerkt, save versucht es erneut und schreibt sonst nicht.
    }
  }

  // Einzelne kaputte Einheiten machen nicht den ganzen Stand unbrauchbar: Sie kommen beiseite, der Rest bleibt.
  function parseStored(text) {
    const raw = JSON.parse(text);
    try {
      return { ...migrate(raw, { migrations, target }), quarantined: 0 };
    } catch (cause) {
      if (!(cause instanceof BrokenStateError)) {
        throw cause;
      }
      const quarantined = quarantineBrokenUnits(raw);
      if (quarantined === 0) {
        throw cause;
      }
      return { ...migrate(raw, { migrations, target }), quarantined };
    }
  }

  // Der Stand, den load nicht lesen konnte. Ist er in Ordnung, lässt er sich unter „Sichern“ zurückholen.
  function rescueUnread(text) {
    preserveBroken(text);
    try {
      parseStored(text);
    } catch {
      return;
    }
    backend.setItem(STORAGE_KEYS.previous, text);
  }

  function load() {
    readFailed = false;
    saveBlockedBy = null;
    let text;
    try {
      text = backend.getItem(STORAGE_KEYS.state);
    } catch (cause) {
      readFailed = true;
      return {
        state: createState(now()),
        error: unreadableError(cause),
        migratedFrom: null,
      };
    }
    if (text == null) {
      return { state: createState(now()), error: null, migratedFrom: null };
    }
    let result;
    try {
      result = parseStored(text);
    } catch (cause) {
      keepBroken(text);
      const error = errorForStoredState(cause);
      if (error.code === "tooNew") {
        saveBlockedBy = error;
      }
      return { state: createState(now()), error, migratedFrom: null };
    }
    if (result.quarantined > 0) {
      keepBroken(text);
      return {
        state: result.state,
        error: loadError(
          "quarantined",
          "Beschädigte Einträge im Lernstand (" + result.quarantined + ") sind beiseitegelegt. Alles andere ist da.",
        ),
        migratedFrom: result.migratedFrom,
      };
    }
    if (result.migratedFrom !== null) {
      // Der Stand vor der Migration bleibt erhalten, denn das nächste save ersetzt ihn.
      try {
        backend.setItem(STORAGE_KEYS.previous, text);
      } catch {
        // Der gelesene Stand ist trotzdem gültig.
      }
    }
    return { state: result.state, error: null, migratedFrom: result.migratedFrom };
  }

  function save(state) {
    if (saveBlockedBy) {
      throw saveBlockedBy;
    }
    // Was load nicht wieder lesen könnte, wird gar nicht erst geschrieben.
    const problem = stateProblem(state);
    if (problem) {
      throw new BrokenStateError("Der Lernstand wurde nicht gespeichert: " + problem);
    }
    if (readFailed) {
      // Wirft das Lesen weiter, wirft auch save. Liegt ein Stand vor, kommt er erst in Sicherheit.
      const stored = backend.getItem(STORAGE_KEYS.state);
      if (stored != null) {
        rescueUnread(stored);
      }
      readFailed = false;
    }
    if (pendingBroken !== null) {
      preserveBroken(pendingBroken);
      pendingBroken = null;
    }
    state.updatedAt = now().toISOString();
    backend.setItem(STORAGE_KEYS.state, JSON.stringify(state));
  }

  function keepPrevious() {
    const text = backend.getItem(STORAGE_KEYS.state);
    if (text == null) {
      return false;
    }
    backend.setItem(STORAGE_KEYS.previous, text);
    return true;
  }

  // Der Stand, den keepPrevious oder eine Migration aufgehoben hat. Fehlt er oder ist er nicht lesbar: null.
  function loadPrevious() {
    const text = backend.getItem(STORAGE_KEYS.previous);
    if (text == null) {
      return null;
    }
    try {
      return parseStored(text).state;
    } catch {
      return null;
    }
  }

  // Alle aufgehobenen Rohfassungen als Texte, die zuletzt aufgehobene zuerst. Sonst eine leere Liste.
  function loadBroken() {
    const latest = backend.getItem(STORAGE_KEYS.broken);
    if (latest == null) {
      return [];
    }
    const found = [latest];
    let number = 1;
    let text = backend.getItem(STORAGE_KEYS.broken + "." + number);
    while (text != null) {
      found.push(text);
      number += 1;
      text = backend.getItem(STORAGE_KEYS.broken + "." + number);
    }
    return found;
  }

  function loadSession() {
    const text = backend.getItem(STORAGE_KEYS.session);
    if (text == null) {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function saveSession(session) {
    backend.setItem(STORAGE_KEYS.session, JSON.stringify(session));
  }

  function clearSession() {
    backend.removeItem(STORAGE_KEYS.session);
  }

  // Die letzten Läufe der Erkennung ohne Text, für den Technik-Bericht: Grund und Zeiten, nie ein Inhalt. Sie überstehen das Neuladen je Satz.
  function loadSpeechLog() {
    try {
      const log = JSON.parse(backend.getItem(SPEECH_LOG_KEY));
      return Array.isArray(log) ? log : [];
    } catch {
      return [];
    }
  }

  function noteSpeechRun(entry) {
    try {
      backend.setItem(SPEECH_LOG_KEY, JSON.stringify([...loadSpeechLog(), entry].slice(-SPEECH_LOG_LIMIT)));
    } catch {
      // Der Bericht ist nur eine Hilfe. Ein voller Speicher darf die Übung nicht stören.
    }
  }

  return { load, save, keepPrevious, loadPrevious, loadBroken, loadSession, saveSession, clearSession, loadSpeechLog, noteSpeechRun };
}
