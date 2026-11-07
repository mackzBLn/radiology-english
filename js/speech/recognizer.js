/*
 * Spracherkennung, ein Lauf je listen. Was schiefgeht, heißt notMeasured und zählt nie als falsch.
 * Ohne DOM, die Klasse lässt sich in den Tests unterschieben.
 *
 * listen liefert immer ein Ergebnis und wirft nicht: { status, transcript, reason, events }
 *   status "heard": transcript ist der zuletzt erkannte Text, reason ist null.
 *   status "notMeasured": reason ist der Fehlercode der Schnittstelle (audio-capture, no-speech, aborted, not-allowed,
 *   service-not-allowed und andere) oder einer von unavailable, startFailed, noAudioStart, noSpeech, noResult, cancelled.
 *   events: [ { name, ms } ], Zeit ab dem Start, für die Fehlersuche.
 * onState meldet starting (vor start), listening (erst bei audiostart), hearing (speechstart), finishing (nach stop).
 *
 * Quellen:
 *   https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition
 *   https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/stop
 *   https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/abort
 *   https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognitionErrorEvent/error
 *   https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognitionEvent/results
 */

// Vorgaben des Bauauftrags. Der erste Start kann über 2 s bis audiostart dauern (Gerätetest Lauf 4), die Zeit zählt ab audiostart.
const NO_SPEECH_MS = { a: 6000, b: 10000 };
const LIMIT_MS = 20000;
// Mit 2500 ms lief der Gerätetest (Lauf 4). Wer beim Sprechen kurz nachdenkt, wird so nicht mitten im Satz abgeschnitten.
const PAUSE_MS = 2500;
// Nach stop kommt meist ein Endergebnis (Gerätetest Lauf 4, dort mit 3000 ms Frist). Bleibt es aus, gilt das letzte Zwischenergebnis.
const FINAL_WAIT_MS = 3000;

const HANDLERS = ["start", "audiostart", "speechstart", "speechend", "audioend", "result", "nomatch", "error", "end"];

let usedOnThisPage = false;

/*
 * Ein zweiter Start im selben Seitenaufruf bringt oft keine Sprache (Gerätetest Lauf 3, Befund 1).
 * Wer eine neue Aufgabe beginnt und das hier true liefert, lädt vorher neu.
 */
export function recognitionUsedOnThisPage() {
  return usedOnThisPage;
}

export function timingsFor(stage) {
  return { noSpeechMs: NO_SPEECH_MS[stage] ?? NO_SPEECH_MS.a, limitMs: LIMIT_MS, pauseMs: PAUSE_MS };
}

// Alle Abschnitte des Ergebnisses, mit Leerzeichen getrennt (Gerätetest Lauf 3, Befund 9).
function transcriptOf(event) {
  const parts = [];
  for (let index = 0; index < event.results.length; index += 1) {
    const text = event.results[index][0]?.transcript?.trim();
    if (text) {
      parts.push(text);
    }
  }
  return parts.join(" ");
}

export function createRecognizer(Ctor = globalThis.webkitSpeechRecognition) {
  let cancelRun = null;

  function isAvailable() {
    return typeof Ctor === "function";
  }

  function listen({ lang, onState, noSpeechMs = NO_SPEECH_MS.a, limitMs = LIMIT_MS, pauseMs = PAUSE_MS } = {}) {
    cancelRun?.();
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const events = [];
      const timers = new Map();
      let recognition = null;
      let transcript = "";
      let audioStarted = false;
      let speechStarted = false;
      let stopping = false;
      let settled = false;

      const note = (name) => events.push({ name, ms: Date.now() - startedAt });

      function clearTimer(name) {
        clearTimeout(timers.get(name));
        timers.delete(name);
      }

      function setTimer(name, delay, callback) {
        clearTimer(name);
        timers.set(name, setTimeout(callback, delay));
      }

      // Genau ein Ergebnis je Lauf. Spätere Ereignisse, auch ein zweites end, laufen ins Leere.
      function settle(status, reason) {
        if (settled) {
          return;
        }
        settled = true;
        for (const id of timers.values()) {
          clearTimeout(id);
        }
        timers.clear();
        cancelRun = null;
        if (recognition) {
          for (const name of HANDLERS) {
            recognition["on" + name] = null;
          }
        }
        resolve({ status, transcript, reason, events });
      }

      function call(method) {
        try {
          recognition?.[method]();
        } catch (error) {
          note(method + " wirft " + error.name);
        }
      }

      // Erst abschließen, dann abort: Der Fehler aborted, der darauf folgt, ersetzt den Grund nicht.
      function abortWith(reason) {
        note("abort " + reason);
        settle("notMeasured", reason);
        call("abort");
      }

      function conclude() {
        if (transcript !== "") {
          settle("heard", null);
        } else {
          settle("notMeasured", speechStarted ? "noResult" : audioStarted ? "noSpeech" : "noAudioStart");
        }
      }

      // stop liefert, was bisher zu hören war. Kommt end nicht in der Frist, zählt das letzte Zwischenergebnis.
      function requestStop(why) {
        if (stopping) {
          return;
        }
        stopping = true;
        clearTimer("noSpeech");
        clearTimer("pause");
        clearTimer("limit");
        note("stop " + why);
        onState?.("finishing");
        setTimer("final", FINAL_WAIT_MS, () => {
          note("keine Antwort nach stop");
          conclude();
          call("abort");
        });
        call("stop");
      }

      function bind() {
        recognition.onstart = () => note("start");
        recognition.onaudioend = () => note("audioend");
        recognition.onnomatch = () => note("nomatch");
        recognition.onaudiostart = () => {
          note("audiostart");
          if (audioStarted || stopping) {
            return;
          }
          audioStarted = true;
          if (!speechStarted) {
            onState?.("listening");
            setTimer("noSpeech", noSpeechMs, () => abortWith("noSpeech"));
          }
        };
        recognition.onspeechstart = () => {
          note("speechstart");
          speechStarted = true;
          clearTimer("noSpeech");
          if (!stopping) {
            onState?.("hearing");
          }
        };
        recognition.onspeechend = () => {
          note("speechend");
          requestStop("speechend");
        };
        recognition.onresult = (event) => {
          note("result");
          const text = transcriptOf(event);
          if (text !== "") {
            transcript = text;
            speechStarted = true;
            clearTimer("noSpeech");
          }
          if (!stopping) {
            setTimer("pause", pauseMs, () => requestStop("pause"));
          }
        };
        recognition.onerror = (event) => {
          note("error " + event.error);
          // Nach stop ist der Satz schon da, ein Fehler beim Abschluss nimmt ihn nicht weg. Vorher zählt der Lauf nicht.
          if (!(stopping && transcript !== "")) {
            settle("notMeasured", event.error ?? "unknown");
          }
        };
        recognition.onend = () => {
          note("end");
          conclude();
        };
      }

      if (!isAvailable()) {
        note("Schnittstelle fehlt");
        settle("notMeasured", "unavailable");
        return;
      }

      cancelRun = () => abortWith("cancelled");
      try {
        // Eine neue Instanz je Lauf (Vorgabe). start läuft direkt im Tipp, ohne await davor.
        recognition = new Ctor();
        if (lang) {
          recognition.lang = lang;
        }
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        bind();
        setTimer("limit", limitMs, () => {
          if (transcript !== "" || speechStarted) {
            requestStop("limit");
          } else {
            abortWith(audioStarted ? "noSpeech" : "noAudioStart");
          }
        });
        onState?.("starting");
        note("start()");
        usedOnThisPage = true;
        recognition.start();
      } catch (error) {
        note("Start wirft " + error.name);
        settle("notMeasured", "startFailed");
      }
    });
  }

  // Bricht den laufenden Lauf ab, etwa beim Verlassen der Ansicht. Sein Ergebnis hat den Grund cancelled.
  function cancel() {
    cancelRun?.();
  }

  return { isAvailable, listen, cancel };
}
