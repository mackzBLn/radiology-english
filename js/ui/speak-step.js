/*
 * Ein Sprechschritt nach Variante H: Anhören per Tipp, Sprechen, Nochmal anhören per Tipp, alles auf einer Seite (Gerätetest Lauf 4).
 * Kennt die Sitzung nicht. Nutzer: views/speak.js und views/placement.js. Schnittstelle:
 *
 *   const step = renderSpeakStep(container, ctx, {
 *     task: { snapshot, stage },   // snapshot mit den Feldern aus planSpeech: en, variants, keywords, softKeywords, situationDe,
 *                                  // meaningDe, noteDe, clinicDependent, prompt, source. stage: "a" nachsprechen, "b" selbst sagen.
 *                                  // promptSource (nur Patientenäußerung): Quelle der Äußerung für den Info-Knopf.
 *     saved: { step: session.step, result: session.result },   // nach dem Neuladen. null oder step null: Die Aufgabe beginnt von vorn.
 *     onChange(stepState) {        // { step, result }, bei jedem neuen Schritt und vor jedem Neuladen: sofort speichern
 *       session.step = stepState.step;
 *       session.result = stepState.result;
 *       ctx.store.saveSession(session);
 *     },
 *     onResult(result) { ... },    // einmal je Versuch, sofort beim Ergebnis, nach onChange, nie beim Wiederherstellen. Hier werten.
 *     onNext() {                   // Tipp auf Weiter oder Überspringen, zählt nur einmal
 *       session.index += 1;
 *       session.step = null;
 *       session.result = null;
 *       ctx.store.saveSession(session);
 *       reloadPage();              // höchstens einmal je Aufgabe (Vorgabe). Nach der letzten Aufgabe nicht nötig.
 *     },
 *   });
 *   return () => step.destroy();   // Aufräumfunktion der Ansicht. Bricht auch eine laufende Erkennung ab, ohne Ergebnis.
 *
 * - container ist der Behälter der Ansicht. Der Schritt zeichnet Karten und die untere Leiste, also darunter nichts mehr anhängen.
 * - result: { outcome, transcript, words: [ { word, status, accuracy } ], against, reason }, nur JSON-Werte.
 *   outcome: understood, partly, notUnderstood oder notMeasured. Bei notMeasured nennt reason den Grund, nichts davon ist falsch.
 * - Ausfall: Der Schritt zeigt „Nochmal versuchen“. Das ruft onChange mit result null und lädt selbst neu, dieselbe Aufgabe kommt wieder.
 * - step: listen, speak, feedback oder failed. Die Ansicht speichert ihn nur und gibt ihn über saved zurück.
 * - Weitere Angaben: nextLabel (Vorgabe „Weiter“), skipLabel (Vorgabe „Überspringen“), showSoundHint (Stummmodus-Hinweis von Anfang an),
 *   showFeedback (false: nach dem Sprechen nur ein Dank, keine Wertung und kein Satz, für den Einstufungstest),
 *   showMeasureNote (Funktion: zeigt die Rückmeldung den Satz zur Verständlichkeit?).
 * - „Weiß ich nicht“: in Stufe b und im Test. Das Ergebnis ist notUnderstood mit reason dontKnow. Mit showFeedback zeigt der Schritt danach
 *   den Mustersatz, sonst ruft er gleich onNext.
 * - „Abbrechen“ während der Erkennung: wie „Nochmal versuchen“, ruft onChange mit result null und lädt neu. Das zählt nicht als Ergebnis.
 * - Vor einer neuen Aufgabe: Liefert recognitionUsedOnThisPage() aus speech/recognizer.js true, erst speichern und reloadPage().
 * - Fehlt die Erkennung ganz: vorher isSpeechAvailable() prüfen und speechMissingCard() zeigen. Sonst endet „Sprechen“ als Ausfall.
 *
 * Quellen:
 *   https://developer.mozilla.org/en-US/docs/Web/API/Location/reload
 *   https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/speak
 *   https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisUtterance
 *   https://developer.mozilla.org/en-US/docs/Web/CSS/display
 */

import { DONT_KNOW, dontKnowResult, initialStep, resultFromHearing, stepAfterResult } from "../core/speak-flow.js";
import { createBrowserAssessor } from "../speech/assessor.js";
import { createRecognizer, timingsFor } from "../speech/recognizer.js";
import { barRow, bottomBar, button, card, clinicNote, englishText, infoButton, negationNote, soundHint } from "./components.js";
import { el } from "./dom.js";

// Beginnt die Ausgabe nicht, gilt sie als verworfen (wie audioButton). Danach ist „Sprechen“ in jedem Fall wieder frei.
const SPEECH_START_LIMIT_MS = 5000;
const SPEECH_END_LIMIT_MS = 15000;

const FAILED_TEXT = "Das hat diesmal nicht geklappt, das zählt nicht als Fehler.";
const SETUP_TEXT = "Prüfe in den Einstellungen des iPhones, ob Siri eingeschaltet und das Mikrofon erlaubt ist.";
const NEEDS_SETUP = ["unavailable", "not-allowed", "service-not-allowed"];
const MEASURE_NOTE = "Das sagt etwas über die Verständlichkeit, nicht über einzelne Laute.";

// Längere Wörter passen nicht einzeilig auf den Knopf „Langsam“.
const SLOW_WORD_LIMIT = 8;

const DONT_KNOW_VERDICT = ["So heißt der Satz", "Hör ihn dir an und sprich ihn laut nach. Er kommt morgen wieder."];

const VERDICT = {
  understood: {
    a: ["Gut verständlich", "Das iPhone hat deinen Satz verstanden."],
    b: ["Gut verständlich", "Deine Antwort ist angekommen."],
  },
  partly: {
    a: ["Teilweise verständlich", "Ein Teil kam an, ein Teil noch nicht. Hör dir die markierten Wörter an."],
    b: ["Teilweise verständlich", "Ein Teil der wichtigen Wörter war zu hören. Vergleiche mit dem Mustersatz."],
  },
  notUnderstood: {
    a: ["Noch nicht verständlich", "Das iPhone hat den Satz diesmal kaum verstanden. Hör ihn dir an, er kommt bald wieder."],
    b: ["Nicht erkannt", "Das iPhone hat deine Antwort nicht erkannt. Richtig sein kann sie trotzdem. Hör dir den Mustersatz an."],
  },
};

// „Jetzt sprechen“ erst nach audiostart, vorher „Einen Moment“: Der erste Start kann über 2 s dauern (Gerätetest Lauf 4, Befund 4).
const LISTEN_DISPLAY = {
  starting: { text: "Einen Moment …", live: false },
  listening: { text: "Jetzt sprechen", live: true },
  hearing: { text: "Ich höre zu …", live: true },
  finishing: { text: "Einen Moment …", live: false },
};

export function isSpeechAvailable() {
  return createRecognizer().isAvailable();
}

// location.reload behält die Route samt Teil nach dem #.
export function reloadPage() {
  globalThis.location.reload();
}

export function speechMissingCard(...extra) {
  return card(
    { class: "card-warn" },
    el("h2", { class: "card-title" }, "Sprechen geht gerade nicht"),
    el("p", null, "Die Spracherkennung fehlt auf diesem Gerät. Das ist kein Fehler von dir."),
    el("p", null, "Prüfe in den Einstellungen des iPhones, ob Siri eingeschaltet ist."),
    ...extra,
  );
}

// Spielt Text ab und zeigt das sofort am Knopf: Nach der Erkennung kann die Ausgabe rund 1,2 s länger dauern (Gerätetest Lauf 4, Befund 3).
function createPlayer(ctx, { onBusy, onSilent }) {
  let active = 0;
  const latestRun = new WeakMap();

  function play(text, { rate = 1, node = null, idleLabel = null } = {}) {
    const run = {};
    let done = false;
    let timer = null;

    function finish(silent) {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      active -= 1;
      if (active === 0) {
        onBusy(false);
      }
      if (node && latestRun.get(node) === run) {
        node.classList.remove("is-speaking");
        node.textContent = silent ? "Nochmal tippen" : idleLabel();
      }
      if (silent) {
        onSilent();
      }
    }

    active += 1;
    onBusy(true);
    if (node) {
      latestRun.set(node, run);
      node.classList.add("is-speaking");
      node.textContent = "Spricht …";
    }
    timer = setTimeout(() => finish(true), SPEECH_START_LIMIT_MS);
    // Direkt im Tipp, ohne await davor: iOS verwirft die Ausgabe sonst still (Gerätetest Lauf 3, Befund 5).
    ctx.tts.speak(text, {
      rate,
      onstart: () => {
        clearTimeout(timer);
        timer = setTimeout(() => finish(false), SPEECH_END_LIMIT_MS);
      },
      onend: () => finish(false),
      onerror: () => finish(true),
    });
  }

  return { play };
}

export function renderSpeakStep(
  container,
  ctx,
  {
    task,
    saved = null,
    nextLabel = "Weiter",
    skipLabel = "Überspringen",
    showFeedback = true,
    showSoundHint = false,
    showMeasureNote = () => true,
    onChange,
    onResult,
    onNext,
    recognizer = createRecognizer(),
    assessor = createBrowserAssessor(),
    reload = reloadPage,
  },
) {
  const { snapshot, stage } = task;
  // Wer den Satz nicht weiß, hat sonst nur „Sprechen“. Nachsprechen geht immer, darum dort nur im Test.
  const offersDontKnow = stage === "b" || !showFeedback;
  // display: contents, damit die untere Leiste direkt im Behälter der Ansicht steht und dort unten klebt.
  const host = el("div", { style: "display:contents" });
  let state = saved?.step ? { step: saved.step, result: saved.result ?? null } : { step: initialStep(task), result: null };
  let speakButton = null;
  let noSoundNote = null;
  let destroyed = false;
  let leaving = false; // Ein zweiter schneller Tipp darf keinen Satz überspringen.

  const player = createPlayer(ctx, {
    onBusy: (busy) => {
      if (speakButton) {
        speakButton.disabled = busy;
      }
    },
    onSilent: () => {
      if (noSoundNote) {
        noSoundNote.hidden = false;
      }
    },
  });

  function show(...children) {
    host.replaceChildren(...children.filter(Boolean));
  }

  function report(nextState) {
    state = nextState;
    onChange({ ...state });
  }

  function playButton(getLabel, getText, { kind = "audio", rate = () => 1, onTap } = {}) {
    const node = el("button", { type: "button", class: "btn btn-" + kind }, getLabel());
    node.addEventListener("click", () => {
      onTap?.();
      player.play(getText(), { rate: rate(), node, idleLabel: getLabel });
    });
    return node;
  }

  function hiddenSoundHint(visible) {
    noSoundNote = soundHint();
    noSoundNote.hidden = !visible;
    return noSoundNote;
  }

  // ---------- Aufgabe ----------

  function sentenceCard(withInstruction) {
    return card(
      el("p", { class: "label" }, "Nachsprechen"),
      el(
        "div",
        { class: "row" },
        el(
          "div",
          { class: "sentence", style: "flex:1 1 auto;min-width:0" },
          englishText(snapshot.en),
          el("p", { class: "meaning-de" }, snapshot.meaningDe),
        ),
        infoButton(snapshot.source),
      ),
      snapshot.noteDe ? el("p", { class: "muted" }, snapshot.noteDe) : null,
      snapshot.clinicDependent ? clinicNote() : null,
      withInstruction ? el("p", { class: "muted" }, "Hör dir den Satz an. Tippe dann auf „Sprechen“ und sprich ihn nach.") : null,
    );
  }

  function patientCard(withInstruction) {
    return card(
      el("p", { class: "label" }, "Dem Patienten antworten"),
      snapshot.situationDe ? el("p", { class: "situation-de" }, snapshot.situationDe) : null,
      withInstruction ? el("p", null, "Hör dir an, was der Patient sagt. Tippe dann auf „Sprechen“ und antworte auf Englisch.") : null,
    );
  }

  function situationCard(withInstruction) {
    return card(
      el("p", { class: "label" }, "Selbst sagen"),
      el("p", { class: "situation-de" }, snapshot.situationDe ?? snapshot.meaningDe),
      withInstruction ? el("p", null, "Was sagst du hier auf Englisch? Tippe auf „Sprechen“.") : null,
    );
  }

  // Stufe a zeigt Satz und Bedeutung, Stufe b nur die Lage oder die Äußerung zum Anhören. Der Satz kommt nach dem Sprechen.
  // Die Anleitung steht nur, solange sie gilt: Während der Erkennung und beim Ausfall gibt es den Knopf „Sprechen“ nicht.
  function taskCard({ withInstruction = true } = {}) {
    if (stage === "a") {
      return sentenceCard(withInstruction);
    }
    return snapshot.prompt ? patientCard(withInstruction) : situationCard(withInstruction);
  }

  function dontKnowButton() {
    return offersDontKnow ? button("Weiß ich nicht", giveUp) : null;
  }

  function drawTask() {
    const audioText = stage === "a" ? snapshot.en : snapshot.prompt;
    const audioIsNext = Boolean(audioText) && state.step === "listen";
    speakButton = button("Sprechen", startSpeaking, { kind: audioIsNext ? "secondary" : "primary" });
    if (!audioText) {
      show(taskCard(), bottomBar(speakButton, dontKnowButton()));
      return;
    }
    const audioLabel = () => {
      if (stage !== "a") {
        return "Patient anhören";
      }
      return state.step === "listen" ? "Anhören" : "Nochmal hören";
    };
    const audio = playButton(audioLabel, () => audioText, {
      kind: audioIsNext ? "primary" : "audio",
      onTap: () => {
        if (state.step === "listen") {
          report({ step: "speak", result: null });
          audio.classList.replace("btn-primary", "btn-audio");
          speakButton.classList.replace("btn-secondary", "btn-primary");
        }
      },
    });
    show(taskCard(), hiddenSoundHint(showSoundHint), bottomBar(barRow(audio, speakButton), dontKnowButton()));
  }

  // ---------- Sprechen ----------

  function startSpeaking() {
    ctx.tts.cancel();
    speakButton = null;
    noSoundNote = null;
    // Eine Anzeige, kein Knopf: Ein Tipp darauf bewirkt nichts. Der Knopf darunter führt zurück zur Aufgabe.
    const statusText = el("span", null, LISTEN_DISPLAY.starting.text);
    const status = el("div", { role: "status", class: "listen-status" }, el("span", { class: "listen-dot" }), statusText);
    show(taskCard({ withInstruction: false }), bottomBar(status, button("Abbrechen", cancelListening)));
    recognizer
      .listen({
        lang: ctx.state.settings.lang,
        ...timingsFor(stage),
        onState: (name) => {
          const display = LISTEN_DISPLAY[name];
          if (display) {
            statusText.textContent = display.text;
            status.classList.toggle("listen-status-live", display.live);
          }
        },
      })
      .then(receive);
  }

  function receive(heard) {
    if (destroyed || leaving) {
      return;
    }
    const result = resultFromHearing(heard, (transcript) => assessor.assess({ unit: snapshot, transcript, stage }));
    try {
      report({ step: stepAfterResult(result), result });
      onResult(result);
    } finally {
      draw();
      globalThis.scrollTo?.(0, 0);
    }
  }

  function giveUp() {
    if (leaving) {
      return;
    }
    ctx.tts.cancel();
    const result = dontKnowResult();
    report({ step: stepAfterResult(result), result });
    onResult(result);
    if (showFeedback) {
      draw();
      globalThis.scrollTo?.(0, 0);
    } else {
      goNext();
    }
  }

  function goNext() {
    if (leaving) {
      return;
    }
    leaving = true;
    ctx.tts.cancel();
    onNext();
  }

  // ---------- Ausfall ----------

  // Dieselbe Aufgabe noch einmal. Neu geladen wird, sonst bringt der nächste Start oft keine Sprache (Gerätetest Lauf 3, Befund 1).
  function retry() {
    if (leaving) {
      return;
    }
    leaving = true;
    report({ step: "speak", result: null });
    ctx.tts.cancel();
    reload();
  }

  // Zurück zur Aufgabe, ohne Ergebnis. receive läuft ins Leere, denn leaving ist dann gesetzt.
  function cancelListening() {
    if (!leaving) {
      recognizer.cancel();
      retry();
    }
  }

  // Zuerst, was los ist und was zu tun bleibt. Die Aufgabe darunter steht nur noch zur Erinnerung.
  function drawFailed() {
    show(
      card(
        { class: "card-warn" },
        el("p", { class: "card-title" }, FAILED_TEXT),
        NEEDS_SETUP.includes(state.result.reason) ? el("p", null, SETUP_TEXT) : null,
      ),
      taskCard({ withInstruction: false }),
      bottomBar(button("Nochmal versuchen", retry, { kind: "primary" }), button(skipLabel, goNext)),
    );
  }

  // ---------- Rückmeldung ----------

  function drawThanks() {
    show(card(el("p", { class: "card-title" }, "Danke, das ist notiert.")), bottomBar(button(nextLabel, goNext, { kind: "primary" })));
  }

  function drawFeedback() {
    if (!showFeedback) {
      drawThanks();
      return;
    }
    const { result } = state;
    const model = result.against ?? snapshot.en;
    const dontKnow = result.reason === DONT_KNOW;
    const [title, text] = dontKnow ? DONT_KNOW_VERDICT : VERDICT[result.outcome][stage];
    const hasMissing = result.words.some((item) => item.status === "missing");

    // „Langsam“ spielt das zuletzt angetippte Wort, sonst den ganzen Satz. Einzeilig, damit die Leiste nicht springt.
    let slowWord = null;
    const slowLabel = () => {
      if (!slowWord) {
        return "Langsam";
      }
      return slowWord.length <= SLOW_WORD_LIMIT ? "„" + slowWord + "“ langsam" : "Wort langsam";
    };
    const slow = playButton(slowLabel, () => slowWord ?? model, { rate: () => ctx.state.settings.slowRate });
    const aimSlow = (word) => {
      slowWord = word;
      if (!slow.classList.contains("is-speaking")) {
        slow.textContent = slowLabel();
      }
    };
    const audio = playButton(() => (stage === "a" ? "Nochmal hören" : "Mustersatz hören"), () => model, { onTap: () => aimSlow(null) });

    const wordButtons = result.words.map(({ word, status }) =>
      el(
        "button",
        {
          type: "button",
          class: "word word-" + status,
          "aria-label": status === "missing" ? word + ", nicht erkannt" : word,
          onclick: () => {
            aimSlow(word);
            player.play(word);
          },
        },
        word,
      ),
    );

    show(
      card(
        { class: result.outcome === "understood" ? "card-ok" : "card-warn" },
        el("h2", { class: "card-title" }, title),
        el("p", null, text),
        result.negationFlip ? negationNote() : null,
        dontKnow ? null : el("p", { class: "label" }, "Das hat das iPhone gehört"),
        dontKnow ? null : el("p", { lang: "en" }, result.transcript),
      ),
      card(
        el(
          "div",
          { class: "row" },
          el("p", { class: "label", style: "flex:1 1 auto;min-width:0" }, stage === "a" ? "Der Satz" : "Mustersatz"),
          infoButton(snapshot.source),
        ),
        wordButtons.length > 0 ? el("div", { class: "word-list", lang: "en" }, wordButtons) : englishText(model),
        dontKnow
          ? null
          : el(
              "p",
              { class: "muted" },
              (stage === "b" ? "Deine Antwort darf anders klingen. " : "") +
                (hasMissing ? "Gestrichelt: nicht erkannt. " : "") +
                (wordButtons.length > 0 ? "Tippe ein Wort an, dann hörst du es." : ""),
            ),
        el("p", { class: "meaning-de" }, snapshot.meaningDe),
        snapshot.noteDe ? el("p", { class: "muted" }, snapshot.noteDe) : null,
        snapshot.clinicDependent ? clinicNote() : null,
      ),
      snapshot.prompt
        ? card(
            el(
              "div",
              { class: "row" },
              el("p", { class: "label", style: "flex:1 1 auto;min-width:0" }, "Der Patient sagte"),
              infoButton(task.promptSource),
            ),
            englishText(snapshot.prompt),
            playButton(() => "Patient anhören", () => snapshot.prompt, { kind: "secondary" }),
          )
        : null,
      showMeasureNote() ? el("p", { class: "muted" }, MEASURE_NOTE) : null,
      hiddenSoundHint(false),
      bottomBar(barRow(audio, slow), button(nextLabel, goNext, { kind: "primary" })),
    );
  }

  // ---------- Zeichnen ----------

  function draw() {
    speakButton = null;
    noSoundNote = null;
    if (state.step === "feedback" && state.result) {
      drawFeedback();
    } else if (state.step === "failed" && state.result) {
      drawFailed();
    } else {
      drawTask();
    }
  }

  function destroy() {
    destroyed = true;
    recognizer.cancel();
    ctx.tts.cancel();
    host.remove();
  }

  container.append(host);
  draw();
  return { destroy };
}
