/*
 * Bahn: eine Runde aus planTrain, eine Übung nach der anderen, einhändig, mit Kopfhörern, ohne Mikrofon und ohne Netz.
 * Den Ablauf ohne DOM führt core/train-run.js, diese Datei zeichnet ihn nur.
 *
 * Ton: Die erste Hörübung startet per Tipp auf „Anhören“. Danach spricht die App direkt im Tipp auf „Weiter“, ohne await,
 * im selben Aufruf wie das Zeichnen der Übung (Gerätetest Lauf 1).
 * Die Runde liegt nicht in der Sitzung, denn die hat nur einen Platz und gehört Sprechen und Einstufung. Jede Antwort steht
 * sofort im Lernstand, die nächste Runde plant von dort aus weiter.
 * Die Uhr steht, solange die Seite verborgen ist: Eine Pause zwischen zwei Stationen zählt nicht zu den 18 Minuten.
 *
 * Quellen:
 *   https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event
 *   https://developer.mozilla.org/en-US/docs/Web/API/HTMLFormElement/submit_event
 *   https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/enterkeyhint
 *   https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Box_alignment/In_flexbox
 *   https://bugs.webkit.org/show_bug.cgi?id=259770
 */

import { matchTyped } from "../../core/matcher.js";
import { planTrain } from "../../core/planner.js";
import {
  HINT_STEPS, advance, builtResult, choiceResult, createRun, currentItem, elapsedMs, feedbackFor, formatClock, gradeAnswer, hasNext,
  hasProgress, isFirstHearing, isHearing, isOverTime, optionsAreEnglish, pauseClock, promptOf, resumeClock, speaksBySelf, summaryOf,
  tileWords, typedAnswer, typingHint, verdictOf,
} from "../../core/train-run.js";
import {
  audioButton, backButton, barRow, bottomBar, button, card, clinicNote, confirmDialog, englishText, hint, infoButton, navButton,
  negationNote, noPatientDataHint, progressBar, soundHint, viewHeader, waitNote,
} from "../components.js";
import { el } from "../dom.js";
import { routeHash } from "../router.js";

const TITLE = "Bahn";
const AGAIN_LABEL = "Nochmal hören";
const FAILED_LABEL = "Nochmal tippen";
// Beginnt die Ausgabe bis dahin nicht, gilt sie als verworfen, wie bei audioButton (Vorgabe aus dem Gerätetest).
const SPEECH_START_LIMIT_MS = 5000;
// Ein zweiter Tipp direkt danach zählt nicht: Sonst wäre ein doppelter Tipp auf „Weiter“ schon die nächste Antwort.
const TAP_GUARD_MS = 300;

// ---------- Bausteine ----------

// Wie audioButton, aber die Ansicht kann die Ausgabe auch selbst starten, direkt im Tipp auf „Weiter“.
function listenButton(text, ctx, label) {
  let playId = 0;
  let startTimer = null;
  const node = el("button", { type: "button", class: "btn btn-audio" }, label);

  function finish(id, nextLabel) {
    if (id === playId) {
      clearTimeout(startTimer);
      node.classList.remove("is-speaking");
      node.textContent = nextLabel;
    }
  }

  function play() {
    playId += 1;
    const id = playId;
    clearTimeout(startTimer);
    node.classList.add("is-speaking");
    node.textContent = "Spricht …";
    startTimer = setTimeout(() => finish(id, FAILED_LABEL), SPEECH_START_LIMIT_MS);
    ctx.tts.speak(text, {
      onstart: () => id === playId && clearTimeout(startTimer),
      onend: () => finish(id, AGAIN_LABEL),
      onerror: () => finish(id, FAILED_LABEL),
    });
  }

  node.addEventListener("click", play);
  return { node, play };
}

function slowButton(text, ctx) {
  return audioButton(text, ctx, { label: "Langsam", rate: ctx.state.settings.slowRate });
}

// Der Inhalt steht unten, in Reichweite des Daumens. Der freie Platz bleibt darüber.
function lowerArea(...children) {
  return el("div", { class: "stack", style: "margin-top:auto" }, ...children);
}

function pinnedBar(...buttons) {
  const bar = bottomBar(...buttons);
  bar.style.marginTop = "0";
  return bar;
}

function englishWithInfo(text, source) {
  const sentence = englishText(text);
  sentence.style.flex = "1 1 auto";
  return el("div", { class: "row" }, sentence, infoButton(source));
}

// Englischer Satz mit Bedeutung, Anhören und Quelle.
function sentenceBlock(ctx, content, { label = null, en, meaningDe, source, separated = false }) {
  return el(
    "div",
    { class: separated ? "sentence reaction" : "sentence" },
    label ? el("p", { class: "label" }, label) : null,
    englishText(en),
    meaningDe ? el("p", { class: "meaning-de" }, meaningDe) : null,
    el("div", { class: "row" }, audioButton(en, ctx), slowButton(en, ctx), infoButton(content.source(source))),
  );
}

function promptCard(label, text, ...more) {
  return card(el("p", { class: text ? "label" : "situation-de" }, label), text ? el("p", { class: "situation-de" }, text) : null, ...more);
}

function firstHearingNotes() {
  return [el("p", null, "Tippe auf „Anhören“."), soundHint()];
}

function compactPatientHint() {
  const node = noPatientDataHint();
  node.style.padding = "4px 8px";
  return node;
}

function yourAnswer(label, text) {
  return el("p", null, el("span", { class: "label" }, label + " "), el("span", { lang: "en" }, text));
}

// Die übrigen Antworten verschwinden sonst ohne Quelle. Eingeklappt, die Karte soll ohne Scrollen passen.
function otherAnswersBlock(content, others) {
  if (others.length === 0) {
    return null;
  }
  return el(
    "details",
    { class: "group" },
    el("summary", null, el("span", null, "Die anderen Antworten")),
    el(
      "div",
      { class: "stack" },
      others.map((other) =>
        el(
          "div",
          { class: "sentence" },
          englishWithInfo(other.text, content.source(other.source)),
          other.meaningDe ? el("p", { class: "meaning-de" }, other.meaningDe) : null,
        ),
      ),
    ),
  );
}

function wrongChoiceBlock(content, wrong) {
  return el(
    "div",
    { class: "sentence reaction" },
    el("p", { class: "label" }, "Das hast du gewählt:"),
    wrong.english ? englishWithInfo(wrong.text, content.source(wrong.source)) : el("p", null, wrong.text),
    wrong.english && wrong.meaningDe ? el("p", { class: "meaning-de" }, wrong.meaningDe) : null,
  );
}

// Nach einer falschen Reaktion zuerst die richtige Antwort. Gehörtes und Gewähltes stehen eingeklappt darunter, die Karte soll ohne Scrollen passen.
function wrongReactionBody(ctx, content, feedback) {
  const { sentence, reaction, wrongChoice } = feedback;
  return [
    sentenceBlock(ctx, content, { ...reaction, label: "Das passt als Antwort:" }),
    feedback.clinic ? clinicNote() : null,
    wrongChoice.whyDe ? el("p", null, wrongChoice.whyDe) : null,
    feedback.noteDe ? el("p", null, feedback.noteDe) : null,
    el(
      "details",
      { class: "group" },
      el("summary", null, el("span", null, "Das hast du gehört und gewählt")),
      el(
        "div",
        { class: "stack" },
        el(
          "div",
          { class: "sentence" },
          el("p", { class: "label" }, "Gehört:"),
          englishWithInfo(sentence.en, content.source(sentence.source)),
          sentence.meaningDe ? el("p", { class: "meaning-de" }, sentence.meaningDe) : null,
          audioButton(sentence.en, ctx),
        ),
        wrongChoiceBlock(content, wrongChoice),
      ),
    ),
    otherAnswersBlock(content, feedback.others),
  ];
}

function feedbackBody(ctx, content, feedback, verdict) {
  return [
    sentenceBlock(ctx, content, { ...feedback.sentence, label: feedback.reaction ? "Das hast du gehört:" : verdict.label }),
    feedback.reaction ? sentenceBlock(ctx, content, { ...feedback.reaction, label: "Das passt als Antwort:", separated: true }) : null,
    feedback.noteDe ? el("p", null, feedback.noteDe) : null,
    feedback.clinic ? clinicNote() : null,
    feedback.wrongChoice ? wrongChoiceBlock(content, feedback.wrongChoice) : null,
    otherAnswersBlock(content, feedback.others),
  ];
}

function wordTile(word, onTap) {
  return el("button", { type: "button", class: "word-tile", lang: "en", onclick: onTap }, word);
}

// ---------- Ohne Übung ----------

function ownHash(focus) {
  return focus ? routeHash("bahn", focus) : routeHash("bahn");
}

function showNothing(container, ctx, focus) {
  container.append(
    viewHeader(ctx, { title: TITLE }),
    card(
      el("h2", { class: "card-title" }, "Gerade gibt es hier nichts zu üben"),
      el("p", null, focus ? "In diesem Bereich ist für heute alles geübt. Du kannst mit allen Sätzen weitermachen." : "Für heute ist alles geübt. Komm morgen wieder."),
    ),
    bottomBar(
      focus ? navButton("Alles üben", ctx, ownHash(null), { kind: "primary" }) : navButton("Zur Startseite", ctx, "#/", { kind: "primary" }),
      backButton(ctx),
    ),
  );
}

function showSummary(container, ctx, run) {
  const summary = summaryOf(run, ctx.now());
  const lines = [
    ["Richtig", summary.right],
    ["Falsch", summary.wrong],
    summary.hinted > 0 ? ["Mit Hinweis", summary.hinted] : null,
    summary.rightOnRetry > 0 ? ["Zweiter Versuch richtig", summary.rightOnRetry] : null,
    ["Neu", summary.fresh],
    ["Zeit", formatClock(summary.elapsedMs)],
  ].filter(Boolean);
  container.replaceChildren(
    viewHeader(ctx, { title: TITLE }),
    card(
      el("h2", { class: "card-title" }, summary.answered > 0 ? "Runde geschafft" : "Runde beendet"),
      el("dl", { class: "facts" }, lines.map(([name, value]) => [el("dt", null, name), el("dd", null, String(value))])),
      summary.comesBack > 0 ? el("p", null, "Was noch nicht saß, kommt morgen wieder.") : null,
    ),
    bottomBar(
      button("Noch eine Runde", () => ctx.navigate(ownHash(run.focus)), { kind: "primary" }),
      navButton("Zur Startseite", ctx, "#/"),
    ),
  );
  window.scrollTo(0, 0);
}

// ---------- Runde ----------

function runRound(container, ctx, content, plan, focus) {
  const run = createRun({ plan, state: ctx.state, focus, now: ctx.now() });
  let nextButton = null; // „Weiter“ der laufenden Anzeige; sein Text ändert sich, wenn die Zeit um ist
  let lastTapAt = -Infinity;

  const timer =el("span", { class: "timer", role: "timer", "aria-label": "Laufzeit" }, formatClock(0));
  const endButton = button("Beenden", askToEnd, { kind: "ghost", style: "flex:0 0 auto;width:auto" });
  const header = viewHeader(ctx, {
    title: TITLE,
    onBack: () => (hasProgress(run) ? askToEnd() : ctx.back()),
    right: el("div", { class: "row", style: "flex:0 0 auto" }, timer, endButton),
  });
  const progressArea = el("div", { class: "stack" });
  const noticeArea = el("div", { class: "stack" });

  function askToEnd() {
    confirmDialog(endButton, {
      title: "Runde beenden?",
      body: el("p", null, "Deine Antworten sind gespeichert."),
      confirmLabel: "Beenden",
      cancelLabel: "Weiter üben",
      onConfirm: finishRound,
    });
  }

  function show(...nodes) {
    container.replaceChildren(header, progressArea, noticeArea, ...nodes.filter(Boolean));
    window.scrollTo(0, 0);
  }

  function guarded(action) {
    return (...args) => {
      if (performance.now() - lastTapAt >= TAP_GUARD_MS) {
        lastTapAt = performance.now();
        action(...args);
      }
    };
  }

  function drawProgress(item) {
    const position = "Übung " + (run.index + 1) + " von " + run.queue.length;
    progressArea.replaceChildren(
      el("p", { class: "progress-text" }, item.retry ? position + ", zweiter Versuch" : position),
      progressBar(run.index, run.queue.length),
    );
  }

  function nextLabel() {
    return hasNext(run, ctx.now()) ? "Weiter" : "Zur Zusammenfassung";
  }

  function makeNextButton() {
    nextButton = button(nextLabel(), guarded(goNext), { kind: "primary" });
    return nextButton;
  }

  // Der Ausstieg auch unten, in Reichweite des Daumens. Ein falscher Tipp öffnet nur die Rückfrage.
  function feedbackActions() {
    const next = makeNextButton();
    return hasNext(run, ctx.now()) ? barRow(button("Beenden", askToEnd), next) : next;
  }

  // ---------- Antworten ----------

  function answer(result, shown) {
    lastTapAt = performance.now();
    ctx.tts.cancel();
    const item = currentItem(run);
    gradeAnswer({ run, state: ctx.state, result, today: ctx.today(), now: ctx.now(), rng: Math.random, save: () => ctx.save() });
    drawFeedback(item, result, shown);
  }

  function drawFeedback(item, result, { chosen = null, typed = null, built = null, close = false, against = null, negationFlip = false }) {
    const { exercise } = item;
    const unit = content.unit(exercise.unitId);
    const feedback = feedbackFor({ exercise, unit, chosen, against });
    const verdict = verdictOf(result, { close, comesAgain: !item.retry && !isOverTime(run, ctx.now()) });
    const wrong = result === "wrong";
    // Der Fortschritt weicht hier: Die Rückmeldung soll möglichst ohne Scrollen auf den Bildschirm passen.
    progressArea.replaceChildren();
    show(
      lowerArea(
        card(
          { class: "card-" + verdict.tone, role: "status" },
          el("h2", { class: "card-title" }, verdict.title),
          negationFlip ? negationNote() : null,
          typed && (close || wrong) ? yourAnswer("Du hast getippt:", typed) : null,
          built && wrong ? yourAnswer("Du hast gelegt:", built.join(" ")) : null,
          wrong && feedback.reaction ? wrongReactionBody(ctx, content, feedback) : feedbackBody(ctx, content, feedback, verdict),
          // Bei „falsch“ steht das schon in der Überschrift.
          verdict.closing && !wrong ? el("p", null, verdict.closing) : null,
        ),
      ),
      pinnedBar(feedbackActions()),
    );
  }

  // ---------- Übungen ----------

  function drawPresent(unit) {
    const first = isFirstHearing(run);
    const listen = listenButton(unit.en, ctx, first ? "Anhören" : AGAIN_LABEL);
    show(
      lowerArea(
        card(
          el("p", { class: "label" }, "Neuer Satz. Hör zu und lies mit."),
          unit.situationDe ? el("p", { class: "situation-de" }, unit.situationDe) : null,
          englishWithInfo(unit.en, content.source(unit.source)),
          el("p", { class: "meaning-de" }, unit.meaningDe),
          unit.noteDe ? el("p", null, unit.noteDe) : null,
          unit.clinicDependent ? clinicNote() : null,
          first ? firstHearingNotes() : null,
        ),
      ),
      pinnedBar(barRow(listen.node, slowButton(unit.en, ctx)), makeNextButton()),
    );
    return listen;
  }

  function drawChoice(exercise, unit) {
    const hearing = isHearing(exercise);
    const first = isFirstHearing(run);
    const { label, text } = promptOf(exercise.kind, unit);
    const lang = optionsAreEnglish(exercise.kind) ? "en" : null;
    const heard = exercise.heardEn ?? unit.en; // Patienten sagen dasselbe verschieden, die Fassung steht in der Übung.
    const listen = hearing ? listenButton(heard, ctx, first ? "Anhören" : AGAIN_LABEL) : null;
    const choose = guarded((option) => answer(choiceResult(option), { chosen: option }));
    show(
      lowerArea(
        promptCard(label, text, first ? firstHearingNotes() : null),
        exercise.options.map((option) => button(option.text, () => choose(option), { kind: "option", lang })),
      ),
      hearing ? pinnedBar(barRow(listen.node, slowButton(heard, ctx))) : null,
    );
    return listen;
  }

  function drawBuild(exercise, unit) {
    const words = tileWords(exercise);
    const placed = []; // Stellen in words, in der gelegten Folge
    const slots = el("div", { class: "word-slots" });
    const taskText = el("p", { class: "label" }, "Bau den Satz. Tippe die Wörter der Reihe nach an.");
    const check = button("Prüfen", () => {
      const built = placed.map((index) => words[index]);
      answer(builtResult(exercise, unit, built), { built });
    }, { kind: "primary", disabled: true });

    function redraw() {
      const inSentence = placed.map((index, position) => wordTile(words[index], () => {
        placed.splice(position, 1);
        redraw();
      }));
      const empty = el("span", { class: "muted", style: "align-self:center" }, "Hier entsteht dein Satz. Antippen legt ein Wort zurück.");
      slots.replaceChildren(...(placed.length === 0 ? [empty] : inSentence));
      // Gelegte Wörter verlassen den Vorrat, so bleibt die Gesamthöhe gleich und die freien Wörter bleiben über der Leiste.
      tiles.forEach((tile, index) => {
        tile.hidden = placed.includes(index);
      });
      taskText.hidden = placed.length > 0;
      situation?.classList.toggle("text-clamped", placed.length > 0);
      check.disabled = placed.length < words.length;
    }

    const situation = unit.situationDe ? el("p", { class: "situation-de" }, unit.situationDe) : null;
    const tiles = words.map((word, index) => wordTile(word, () => {
      placed.push(index);
      redraw();
    }));
    redraw();
    show(
      lowerArea(card(taskText, situation), slots, el("div", { class: "word-tiles" }, tiles)),
      pinnedBar(check),
    );
  }

  function drawType(unit) {
    let hintStep = 0;
    const input = el("input", {
      class: "input", type: "text", lang: "en", autocorrect: "off", autocapitalize: "off", spellcheck: "false", autocomplete: "off",
      enterkeyhint: "done", placeholder: "Dein Satz auf Englisch", "aria-label": "Dein Satz auf Englisch",
    });
    const hintArea = el("div", { class: "stack" });

    function submit() {
      const typed = input.value.trim();
      if (typed !== "") {
        input.blur();
        const { result, ...shown } = typedAnswer(matchTyped(unit, typed), hintStep > 0);
        answer(result, { typed, ...shown });
      }
    }

    const hintButton = button("Hinweis", () => {
      hintStep += 1;
      const shown = typingHint(unit.en, hintStep);
      hintArea.replaceChildren(card(el("p", { class: "label" }, shown.textDe), englishText(shown.en)));
      hintButton.disabled = hintStep >= HINT_STEPS;
    });
    const check = button("Prüfen", submit, { kind: "primary", disabled: true });
    input.addEventListener("input", () => {
      check.disabled = input.value.trim() === "";
    });
    const onsubmit = (event) => {
      event.preventDefault();
      submit();
    };
    show(
      lowerArea(
        promptCard("Tippe den Satz auf Englisch.", unit.situationDe),
        // „Hinweis“ über dem Feld: Die Leiste unten kann die Tastatur verdecken (WebKit-Bug 259770), Prüfen geht dann über die Eingabetaste.
        // Der Text zu den Patientendaten direkt unter dem Feld, in jeder Übung: Er gehört zu jedem Freitextfeld (Vorgabe).
        el("form", { class: "stack", onsubmit }, hintArea, hintButton, input, compactPatientHint()),
      ),
      pinnedBar(check),
    );
  }

  // Läuft im Tipp auf „Weiter“: kein await, die Hörübung spricht noch in diesem Aufruf (Gerätetest Lauf 1).
  function drawExercise() {
    const item = currentItem(run);
    const { exercise } = item;
    const unit = content.unit(exercise.unitId);
    nextButton = null;
    drawProgress(item);
    let listen = null;
    if (exercise.kind === "present") {
      listen = drawPresent(unit);
    } else if (exercise.kind === "buildSentence") {
      drawBuild(exercise, unit);
    } else if (exercise.kind === "typeSentence") {
      drawType(unit);
    } else {
      listen = drawChoice(exercise, unit);
    }
    if (listen && speaksBySelf(run)) {
      listen.play();
    } else {
      ctx.tts.cancel();
    }
  }

  function goNext() {
    if (advance(run, ctx.now())) {
      drawExercise();
    } else {
      finishRound();
    }
  }

  // ---------- Uhr und Ende ----------

  function tick() {
    const now = ctx.now();
    timer.textContent = formatClock(elapsedMs(run, now));
    if (isOverTime(run, now) && noticeArea.childElementCount === 0) {
      noticeArea.append(hint("18 Minuten sind um. Nach dieser Übung ist Schluss."));
    }
    if (nextButton && nextButton.textContent !== nextLabel()) {
      nextButton.textContent = nextLabel();
    }
  }

  function onVisibilityChange() {
    if (document.hidden) {
      pauseClock(run, ctx.now());
    } else {
      resumeClock(run, ctx.now());
      tick();
    }
  }

  const timerId = setInterval(tick, 1000);
  document.addEventListener("visibilitychange", onVisibilityChange);

  function stop() {
    clearInterval(timerId);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    ctx.tts.cancel();
  }

  function finishRound() {
    stop();
    pauseClock(run, ctx.now());
    showSummary(container, ctx, run);
  }

  drawExercise();
  return stop;
}

export async function render(container, ctx, params) {
  container.classList.add("large-targets");
  const focus = params?.focus ?? null;
  const header = viewHeader(ctx, { title: TITLE });
  const wait = waitNote();
  container.append(header, wait);
  const content = await ctx.getContent();
  if (!container.isConnected) {
    return undefined; // Inzwischen ist eine andere Ansicht offen.
  }
  header.remove();
  wait.remove();
  const plan = planTrain({ content, state: ctx.state, today: ctx.today(), rng: Math.random, focus });
  if (plan.length === 0) {
    showNothing(container, ctx, focus);
    return undefined;
  }
  return runRound(container, ctx, content, plan, focus);
}
