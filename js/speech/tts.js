/*
 * Sprachausgabe: Stimmen auswählen und Sätze sprechen. Alles läuft auf dem Gerät.
 * Quellen:
 *   https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis
 *   https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/getVoices
 *   https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/voiceschanged_event
 *   https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisUtterance
 *   https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisErrorEvent/error
 */

// Abstand zwischen cancel() und dem neuen speak() (Gerätetest Lauf 1, Folgerung 6).
const RESTART_DELAY_MS = 120;
const FALLBACK_LANG = "en-GB";

const NOVELTY_NAMES = [
  "Albert", "Bad News", "Bahh", "Bells", "Boing", "Bubbles", "Cellos", "Deranged", "Fred", "Good News", "Hysterical",
  "Jester", "Junior", "Kathy", "Organ", "Ralph", "Superstar", "Trinoids", "Whisper", "Wobble", "Zarvox",
];

// Reihenfolge der Vorgabe. Das Feld default der Stimmen zählt bewusst nicht.
const PREFERRED = [
  { name: "Daniel", lang: "en-gb" },
  { name: "Samantha", lang: "en-us" },
  { name: "Karen" },
  { name: "Moira" },
];

function langOf(voice) {
  return String(voice.lang ?? "").replace("_", "-").toLowerCase();
}

function isNamed(voice, name) {
  const voiceName = String(voice.name ?? "");
  return voiceName === name || voiceName.startsWith(name + " ");
}

function usableVoices(rawVoices) {
  const seen = new Set();
  const result = [];
  for (const voice of rawVoices) {
    const lang = langOf(voice);
    const english = lang === "en" || lang.startsWith("en-");
    if (!english || NOVELTY_NAMES.some((name) => isNamed(voice, name))) {
      continue;
    }
    const nameKey = "name:" + voice.name + "|" + lang;
    const uriKey = "uri:" + voice.voiceURI;
    if (seen.has(nameKey) || seen.has(uriKey)) {
      continue;
    }
    seen.add(nameKey);
    seen.add(uriKey);
    result.push(voice);
  }
  return result;
}

// Abgebrochene Ausgaben melden den Fehler canceled oder interrupted. Für die Ansicht ist das ein normales Ende.
function isCancellation(event) {
  return event?.error === "canceled" || event?.error === "interrupted";
}

// getSettings liefert state.settings, damit die gewählte Stimme auch nach dem Einlesen einer Sicherung stimmt.
export function createTts(
  synth = globalThis.speechSynthesis,
  { getSettings = () => null, Utterance = globalThis.SpeechSynthesisUtterance } = {},
) {
  let voices = [];
  let restartTimer = null;
  let active = null; // die laufende Ausgabe; hält ihre Äußerung fest, bis sie fertig ist
  const voiceListeners = new Set();

  // Eine leere Liste überschreibt keine volle (Vorgabe).
  function refreshVoices() {
    const fresh = usableVoices(synth ? synth.getVoices() ?? [] : []);
    if (fresh.length > 0) {
      voices = fresh;
    }
    return voices;
  }

  // Einmal gleich beim Start, wie auf der Testseite: Die Liste kann beim ersten Aufruf leer sein und füllt sich erst danach (Gerätetest Lauf 2).
  // Käme der erste Aufruf erst im Tipp, spräche die gewählte Stimme beim ersten Vortrag nicht.
  refreshVoices();

  if (synth && typeof synth.addEventListener === "function") {
    synth.addEventListener("voiceschanged", () => {
      refreshVoices();
      for (const listener of voiceListeners) {
        listener();
      }
    });
  }

  function listVoices() {
    return [...refreshVoices()];
  }

  function chooseVoice(settings) {
    const list = refreshVoices();
    const chosen = settings?.voiceURI ? list.find((voice) => voice.voiceURI === settings.voiceURI) : null;
    if (chosen) {
      return chosen;
    }
    for (const { name, lang } of PREFERRED) {
      const found = list.find((voice) => isNamed(voice, name) && (!lang || langOf(voice) === lang));
      if (found) {
        return found;
      }
    }
    return list[0] ?? null;
  }

  function isSpeaking() {
    return Boolean(synth && (synth.speaking || synth.pending));
  }

  // Jede Ausgabe endet für die Ansicht genau einmal, auch wenn eine neue sie ablöst.
  function endActive() {
    if (active) {
      active.finish(active.onend, { error: "canceled" });
    }
  }

  // Der Aufruf von synth.speak bleibt direkt im Tipp: kein await und kein Timer, solange nichts läuft.
  function speak(text, { rate = 1, onstart, onend, onerror } = {}) {
    if (!synth || typeof Utterance !== "function") {
      onerror?.({ error: "unavailable" });
      return;
    }
    const settings = getSettings();
    const voice = chooseVoice(settings);
    const utterance = new Utterance(text);
    if (voice) {
      utterance.voice = voice;
    }
    utterance.lang = voice?.lang ?? settings?.lang ?? FALLBACK_LANG;
    utterance.rate = rate;

    const run = {
      utterance,
      onend,
      done: false,
      finish(callback, event) {
        if (run.done) {
          return;
        }
        run.done = true;
        if (active === run) {
          active = null;
        }
        callback?.(event);
      },
    };
    utterance.onstart = (event) => {
      if (!run.done) {
        onstart?.(event);
      }
    };
    utterance.onend = (event) => run.finish(onend, event);
    utterance.onerror = (event) => run.finish(isCancellation(event) ? onend : onerror, event);

    const busy = restartTimer !== null || isSpeaking();
    endActive();
    active = run;
    if (!busy) {
      synth.speak(utterance);
      return;
    }
    // Spricht gerade etwas: erst cancel, dann nach kurzer Pause speak (Gerätetest Lauf 1, Folgerung 6).
    clearTimeout(restartTimer);
    synth.cancel();
    restartTimer = setTimeout(() => {
      restartTimer = null;
      synth.speak(utterance);
    }, RESTART_DELAY_MS);
  }

  function cancel() {
    clearTimeout(restartTimer);
    restartTimer = null;
    const speakingNow = isSpeaking();
    endActive();
    if (speakingNow) {
      synth.cancel();
    }
  }

  // Für die Einstellungen: meldet, wenn die Stimmenliste sich geändert hat. Gibt die Abmeldung zurück.
  function onVoicesChanged(listener) {
    voiceListeners.add(listener);
    return () => voiceListeners.delete(listener);
  }

  return { listVoices, chooseVoice, speak, cancel, isSpeaking, onVoicesChanged };
}
