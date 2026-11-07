/*
 * Einstufungstest: Hören, Schreiben, Sprechen, etwa 10 Minuten. Der Test ändert keine Lerneinheiten.
 * Die Fassung liegt als Schnappschuss mit aufgelösten Quellen in der Sitzung. Das Neuladen im Sprechteil braucht deshalb keine Inhaltsdaten.
 *
 * Sitzung: { kind: "placement", appVersion, form: { id, items }, queue, index, answers, step, result,
 *            speakingReady, resumeOnLoad, retake, attemptAt }
 *   queue         IDs der Aufgaben in dieser Folge. Beim Wiederholen des Sprechteils nur die nicht gemessenen.
 *   answers       je ID correct, wrong oder notMeasured, sofort gespeichert. correct und wrong sind endgültig.
 *   step, result  Stand des Sprechschritts, siehe speak-step.js.
 *   resumeOnLoad  Die App lädt selbst neu. Nach dem Laden geht es ohne Rückfrage weiter.
 *   attemptAt     Zeit des Versuchs. So landet ein Versuch genau einmal im Lernstand, auch wenn die App beim Speichern endet.
 *
 * Quellen:
 *   https://developer.mozilla.org/en-US/docs/Web/API/Window/fetch
 *   https://developer.mozilla.org/en-US/docs/Web/API/Location/reload
 *   https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/enterkeyhint
 *   https://developer.mozilla.org/en-US/docs/Web/CSS/grid-template-columns
 */

import { matchTyped } from "../../core/matcher.js";
import { buildPlan, chooseForm, compareAttempts, scorePlacement, WEIGHTS } from "../../core/placement.js";
import { recognitionUsedOnThisPage } from "../../speech/recognizer.js";
import {
  audioButton,
  backButton,
  barRow,
  bottomBar,
  button,
  card,
  formatDate,
  hint,
  infoButton,
  noPatientDataHint,
  progressBar,
  soundHint,
  viewHeader,
  waitNote,
} from "../components.js";
import { el } from "../dom.js";
import { isSpeechAvailable, reloadPage, renderSpeakStep, speechMissingCard } from "../speak-step.js";

export const SESSION_KIND = "placement";

const TITLE = "Einstufungstest";
const PART_ORDER = ["listening", "writing", "speaking"];
const PART_LABELS = { listening: "Hören", writing: "Schreiben", speaking: "Sprechen" };
const SPEECH_ANSWER = { understood: "correct", partly: "wrong", notUnderstood: "wrong", notMeasured: "notMeasured" };
const SCALE_SOURCE = "cefr-cv";
const THREE_COLUMNS_STYLE = "grid-template-columns:minmax(0,1fr) auto auto";
const LIST_STYLE = "margin:0;padding-left:20px";
const ROUGH_TEXT = "Das ist eine grobe Orientierung, keine Prüfung und kein Zertifikat.";

// ---------- Sitzung und Wertung, ohne DOM ----------

function shuffled(list, rng) {
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(rng() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

// Ordnet die Aufgaben nach Teil, mischt die Antworten einmal und löst die Quellen auf. resolveSource ist content.source.
export function createFormSnapshot(form, resolveSource, rng) {
  const items = PART_ORDER.flatMap((part) => form.items.filter((item) => item.part === part)).map((item) => {
    const snapshot = { ...item, prompt: null, source: resolveSource(item.source) };
    if (item.options) {
      snapshot.options = shuffled(item.options, rng).map((option) => ({ ...option, source: resolveSource(option.source) }));
    }
    return snapshot;
  });
  return { id: form.id, items };
}

export function createPlacementSession({ form, appVersion }) {
  return {
    kind: SESSION_KIND,
    appVersion,
    form,
    queue: form.items.map((item) => item.id),
    index: 0,
    answers: {},
    step: null,
    result: null,
    speakingReady: false,
    resumeOnLoad: false,
    retake: false,
    attemptAt: null,
  };
}

function isFinal(answer) {
  return answer === "correct" || answer === "wrong";
}

// Wiederholung: nur die Sprechaufgaben ohne Messung, alle anderen Antworten bleiben. Der Versuch bleibt derselbe.
export function createRetakeSession({ form, attempt, appVersion }) {
  const queue = form.items.filter((item) => item.part === "speaking" && !isFinal(attempt.answers[item.id])).map((item) => item.id);
  return { ...createPlacementSession({ form, appVersion }), queue, answers: { ...attempt.answers }, retake: true, attemptAt: attempt.at };
}

export function sessionUsable(session, appVersion) {
  return (
    session?.kind === SESSION_KIND &&
    session.appVersion === appVersion &&
    Array.isArray(session.form?.items) &&
    Array.isArray(session.queue) &&
    Number.isInteger(session.index) &&
    session.index >= 0 &&
    session.index <= session.queue.length &&
    session.answers !== null &&
    typeof session.answers === "object"
  );
}

export function currentItem(session) {
  return session.form.items.find((item) => item.id === session.queue[session.index]) ?? null;
}

// Jede Aufgabe zählt genau einmal. Nur notMeasured darf ein späterer Versuch noch ersetzen, das ist kein Ergebnis.
export function recordAnswer(session, itemId, answer) {
  if (isFinal(session.answers[itemId])) {
    return false;
  }
  session.answers[itemId] = answer;
  return true;
}

// Wertet das Ergebnis des Sprechschritts. Darf öfter laufen, auch nach einem Neuladen.
export function recordSpeech(session, item) {
  return session.result ? recordAnswer(session, item.id, SPEECH_ANSWER[session.result.outcome] ?? "notMeasured") : false;
}

// Ein fehlendes oder zusätzliches not dreht den Sinn um, das zählt wie in der Bahn als falsch.
export function answerFromTyping(item, text) {
  const match = matchTyped(item, text);
  return match.outcome === "wrong" || match.negationFlip === true ? "wrong" : "correct";
}

export function advance(session) {
  session.index += 1;
  session.step = null;
  session.result = null;
}

// Fehlt die Erkennung oder lässt sie den Teil aus: Alles Offene zählt als nicht gemessen, nichts davon als falsch.
export function skipRemainingSpeaking(session) {
  for (const id of session.queue.slice(session.index)) {
    recordAnswer(session, id, "notMeasured");
  }
  session.index = session.queue.length;
  session.step = null;
  session.result = null;
}

export function attemptFrom(session) {
  return { ...scorePlacement(session.form, session.answers), at: session.attemptAt, answers: { ...session.answers } };
}

// Derselbe Zeitpunkt ist derselbe Versuch: ersetzen, nicht doppelt anlegen.
export function storeAttempt(state, attempt, plan) {
  const { attempts } = state.placement;
  const known = attempts.findIndex((entry) => entry.at === attempt.at);
  if (known >= 0) {
    attempts[known] = attempt;
  } else {
    attempts.push(attempt);
  }
  state.placement.plan = plan;
}

export function speakingOpen(attempt) {
  const levels = attempt?.parts?.speaking?.levels;
  return Boolean(attempt?.answers && levels) && Object.values(levels).some((level) => level.notMeasured > 0);
}

// ---------- Laden ----------

async function loadFormSnapshot(ctx, formId) {
  const [response, content] = await Promise.all([fetch("daten/einstufung.json"), ctx.getContent()]);
  if (!response.ok) {
    throw new Error("Einstufung nicht geladen, Status " + response.status);
  }
  const { forms } = await response.json();
  const form = forms.find((entry) => entry.id === formId);
  if (!form) {
    throw new Error("Fassung " + formId + " fehlt");
  }
  return createFormSnapshot(form, (ref) => content.source(ref), Math.random);
}

// ---------- Bausteine ----------

function draw(view, ...children) {
  view.container.replaceChildren(...children.filter(Boolean));
  globalThis.scrollTo?.(0, 0);
}

function testHeader(ctx) {
  return viewHeader(ctx, { title: TITLE });
}

function progressBlock(session, item) {
  const queued = session.queue.map((id) => session.form.items.find((entry) => entry.id === id));
  const ofPart = queued.filter((entry) => entry.part === item.part);
  const parts = PART_ORDER.filter((part) => queued.some((entry) => entry.part === part));
  const partText = parts.length > 1 ? "Teil " + (parts.indexOf(item.part) + 1) + " von " + parts.length + ", " : "";
  return el(
    "div",
    { class: "stack" },
    el("p", { class: "progress-text" }, partText + PART_LABELS[item.part] + ": Aufgabe " + (ofPart.indexOf(item) + 1) + " von " + ofPart.length),
    progressBar(session.index, session.queue.length),
  );
}

function showLoadFailed(view, retry) {
  const { ctx } = view;
  draw(
    view,
    testHeader(ctx),
    card(
      { class: "card-warn" },
      el("h2", { class: "card-title" }, "Der Test lässt sich gerade nicht laden"),
      el("p", null, "Das ist kein Fehler von dir. Versuche es gleich noch einmal."),
    ),
    bottomBar(button("Nochmal versuchen", retry, { kind: "primary" }), backButton(ctx)),
  );
}

function answerAndContinue(view, session, item, answer) {
  view.ctx.tts.cancel();
  recordAnswer(session, item.id, answer);
  advance(session);
  view.ctx.store.saveSession(session); // Antwort und nächste Aufgabe in einem Schreibvorgang, so zählt nichts doppelt.
  run(view, session);
}

// Die Rückfrage entfällt nur, wenn die App selbst neu lädt.
function reloadKeepingSession(ctx, session) {
  session.resumeOnLoad = true;
  ctx.store.saveSession(session);
  reloadPage();
}

// ---------- Hören ----------

function optionRow(option, onPick) {
  return el("div", { class: "row" }, button(option.en, onPick, { kind: "option", lang: "en" }), infoButton(option.source));
}

function showListening(view, session, item) {
  const { ctx } = view;
  const choices = el("div", { class: "stack" });
  const instruction = el("p", null, "Tippe auf „Anhören“ und hör gut zu.");
  const bar = bottomBar();
  const pick = (answer) => answerAndContinue(view, session, item, answer);
  let revealed = false;

  // Der Satz bleibt unsichtbar. Die Ausgabe startet im Tipp selbst, die Antworten kommen mit dem ersten Tipp (Gerätetest Lauf 1).
  const audio = audioButton(item.en, ctx, {
    label: "Anhören",
    kind: "primary",
    onTap: () => {
      if (revealed) {
        return;
      }
      revealed = true;
      audio.classList.replace("btn-primary", "btn-audio");
      instruction.textContent = "Tippe die passende Antwort an. Du kannst den Satz nochmal anhören.";
      choices.append(...item.options.map((option) => optionRow(option, () => pick(option.fits ? "correct" : "wrong"))));
      bar.append(button("Weiß ich nicht", () => pick("wrong")));
    },
  });
  bar.append(audio);

  draw(
    view,
    testHeader(ctx),
    progressBlock(session, item),
    card(el("p", { class: "label" }, "Hören"), el("p", { class: "situation-de" }, item.situationDe), instruction),
    session.index === 0 ? soundHint() : null,
    choices,
    bar,
  );
}

// ---------- Schreiben ----------

function showWriting(view, session, item) {
  const { ctx } = view;
  const input = el("input", {
    class: "input",
    type: "text",
    lang: "en",
    autocomplete: "off",
    autocorrect: "off",
    autocapitalize: "off",
    spellcheck: "false",
    enterkeyhint: "done",
    "aria-label": "Dein Satz auf Englisch",
  });

  function submit() {
    const text = input.value.trim();
    if (text !== "") {
      answerAndContinue(view, session, item, answerFromTyping(item, text));
    }
  }

  const next = button("Weiter", submit, { kind: "primary", disabled: true });
  input.addEventListener("input", () => {
    next.disabled = input.value.trim() === "";
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  });

  draw(
    view,
    testHeader(ctx),
    progressBlock(session, item),
    card(
      el("p", { class: "label" }, "Schreiben"),
      el("p", { class: "situation-de" }, item.situationDe),
      el("p", null, "Schreib den Satz auf Englisch."),
      input,
      noPatientDataHint(),
    ),
    bottomBar(next, button("Weiß ich nicht", () => answerAndContinue(view, session, item, "wrong"))),
  );
}

// ---------- Sprechen ----------

function skipSpeakingAndFinish(view, session) {
  skipRemainingSpeaking(session);
  view.ctx.store.saveSession(session);
  run(view, session);
}

function showSpeechMissing(view, session) {
  const { ctx } = view;
  draw(
    view,
    testHeader(ctx),
    speechMissingCard(el("p", null, "Der Sprechteil zählt deshalb als nicht gemessen, nicht als falsch. Du kannst ihn später allein wiederholen.")),
    bottomBar(button("Zum Ergebnis", () => skipSpeakingAndFinish(view, session), { kind: "primary" }), backButton(ctx)),
  );
}

function showSpeakingIntro(view, session) {
  const { ctx } = view;
  const count = session.queue.length - session.index;
  draw(
    view,
    testHeader(ctx),
    card(
      el("h2", { class: "card-title" }, "Jetzt kommt der Sprechteil"),
      el("p", null, (count === 1 ? "1 Aufgabe" : count + " Aufgaben") + ". Setz Kopfhörer auf und such dir einen ruhigen Ort."),
      el("p", null, "Gleich wirst du nach dem Mikrofon gefragt. Erlaube es bitte."),
      el("p", null, "Die App misst nur, ob deine Sätze verstanden werden, nicht einzelne Laute."),
      el("p", { class: "muted" }, "Geht es gerade nicht? Dann lass den Teil aus und wiederhole ihn später allein. Das zählt nicht als Fehler."),
    ),
    bottomBar(
      button(
        "Sprechteil starten",
        () => {
          session.speakingReady = true;
          ctx.store.saveSession(session);
          run(view, session);
        },
        { kind: "primary" },
      ),
      button("Sprechteil auslassen", () => skipSpeakingAndFinish(view, session)),
    ),
  );
}

function showSpeaking(view, session, item) {
  const { ctx, container } = view;
  // Endete die App zwischen Ergebnis und Wertung, kommt die Wertung jetzt. Sonst ändert das nichts.
  if (session.result && recordSpeech(session, item)) {
    ctx.store.saveSession(session);
  }
  if (!isSpeechAvailable()) {
    showSpeechMissing(view, session);
    return;
  }
  if (!session.speakingReady) {
    showSpeakingIntro(view, session);
    return;
  }
  // Lief die Erkennung auf dieser Seite schon, bringt der nächste Start oft keine Sprache (Gerätetest Lauf 3, Befund 1).
  if (!session.result && recognitionUsedOnThisPage()) {
    draw(view, testHeader(ctx), waitNote());
    reloadKeepingSession(ctx, session);
    return;
  }

  const firstSpeaking = session.form.items.find((entry) => session.queue.includes(entry.id) && entry.part === "speaking");
  draw(view, testHeader(ctx), progressBlock(session, item));
  view.step = renderSpeakStep(container, ctx, {
    task: { snapshot: item, stage: item.type === "repeat" ? "a" : "b" },
    saved: { step: session.step, result: session.result },
    showFeedback: false,
    showSoundHint: item === firstSpeaking,
    nextLabel: session.index + 1 < session.queue.length ? "Weiter" : "Zum Ergebnis",
    reload: () => reloadKeepingSession(ctx, session),
    onChange: ({ step, result }) => {
      session.step = step;
      session.result = result;
      ctx.store.saveSession(session);
    },
    onResult: () => {
      if (recordSpeech(session, item)) {
        ctx.store.saveSession(session);
      }
    },
    onNext: () => {
      advance(session);
      ctx.store.saveSession(session);
      if (currentItem(session)) {
        reloadKeepingSession(ctx, session); // Neuladen je Aufgabe (Gerätetest Lauf 3 und 4).
      } else {
        run(view, session);
      }
    },
  });
}

// ---------- Ergebnis ----------

function levelText(level, belowA1 = false) {
  if (level === null) {
    return "nicht gemessen";
  }
  return belowA1 ? "unter A1" : level;
}

// Je Teil die Stufe. Ein eingelesener Stand muss nicht alle Teile tragen, was fehlt, heißt nicht gemessen.
export function resultRows(attempt) {
  return PART_ORDER.map((part) => {
    const result = attempt.parts?.[part];
    return { labelDe: PART_LABELS[part], text: levelText(result?.level ?? null, result?.belowA1 === true) };
  });
}

// Die Stufe in groß. Liegen alle gemessenen Teile unter A1, sagt das auch die Zusammenfassung.
export function overallText(attempt) {
  if (!attempt.overall) {
    return "Noch keine Stufe";
  }
  const measured = PART_ORDER.map((part) => attempt.parts?.[part]).filter((result) => result?.level);
  return measured.length > 0 && measured.every((result) => result.belowA1 === true) ? "Unter A1" : "Stufe " + attempt.overall;
}

function weightsText() {
  const shares = ["speaking", "listening", "writing"].map((part) => PART_LABELS[part] + " " + Math.round(WEIGHTS[part] * 100) + " %");
  return "So zählen die Teile: " + shares.join(", ") + ". Gewertet wird nur, was gemessen wurde.";
}

function comparisonCard(attempts) {
  if (attempts.length < 2) {
    return card(el("p", { class: "muted" }, "Mach den Test später noch einmal, dann siehst du hier den Vergleich."));
  }
  const first = attempts[0];
  const latest = attempts.at(-1);
  const comparison = compareAttempts(first, latest);
  const rows = PART_ORDER.map((part) => [
    PART_LABELS[part],
    levelText(comparison[part].first, comparison[part].firstBelowA1),
    levelText(comparison[part].latest, comparison[part].latestBelowA1),
  ]);
  rows.push(["Gesamt", levelText(comparison.overall.first), levelText(comparison.overall.latest)]);
  return card(
    el("p", { class: "card-title" }, "Erster und letzter Versuch"),
    el(
      "dl",
      { class: "facts", style: THREE_COLUMNS_STYLE },
      el("dt", null, "Teil"),
      el("dd", { class: "label" }, "Erster"),
      el("dd", { class: "label" }, "Letzter"),
      rows.map(([label, before, after]) => [el("dt", null, label), el("dd", null, before), el("dd", null, after)]),
    ),
    el("p", { class: "muted" }, "Erster Versuch am " + formatDate(first.at) + ", letzter am " + formatDate(latest.at) + "."),
  );
}

function listCard(title, lines) {
  return lines?.length > 0
    ? card(el("p", { class: "card-title" }, title), el("ul", { style: LIST_STYLE }, lines.map((line) => el("li", null, line))))
    : null;
}

// Wie „Weiterlernen“ auf der Startseite direkt in den nächsten Abschnitt. Der Test verlässt den Verlauf: Zurück führt von dort nicht in seine Einleitung.
function continueButton(ctx, kind) {
  const label = "Weiterlernen";
  const action = button(label, async () => {
    action.disabled = true;
    action.textContent = "Einen Moment …";
    try {
      const [{ nextHash }, content] = await Promise.all([import("./path.js"), ctx.getContent()]);
      ctx.navigate(nextHash(content, ctx.state), { replace: true });
    } finally {
      action.disabled = false;
      action.textContent = label;
    }
  }, { kind });
  return action;
}

function calculationDetails(scale) {
  return el(
    "details",
    { class: "group" },
    el("summary", null, el("span", null, "So wird das berechnet")),
    el(
      "div",
      { class: "stack" },
      el("p", { class: "muted" }, weightsText()),
      el("p", { class: "muted" }, "Beim Sprechen misst die App nur, ob deine Sätze verstanden werden, nicht einzelne Laute."),
      el(
        "div",
        { class: "row" },
        el("p", { class: "muted", style: "flex:1 1 auto;min-width:0" }, "Die Stufen A1 bis B2 stammen aus dem Referenzrahmen des Europarats."),
        infoButton(scale),
      ),
    ),
  );
}

async function showResult(view, attempt) {
  const { ctx, container } = view;
  let scale = null;
  try {
    scale = (await ctx.getContent()).source(SCALE_SOURCE);
  } catch {
    // Das Ergebnis steht im Lernstand. Ohne Inhaltsdaten fehlt nur die Angabe zur Quelle.
  }
  if (!container.isConnected) {
    return;
  }
  const { attempts, plan } = ctx.state.placement;
  const canRetake = speakingOpen(attempt);
  draw(
    view,
    viewHeader(ctx, { title: "Dein Ergebnis" }),
    card(
      el("p", { class: "label" }, "Zusammengefasst"),
      el("h2", { class: "result-level" }, overallText(attempt)),
      hint(ROUGH_TEXT),
      el("dl", { class: "facts" }, resultRows(attempt).map((row) => [el("dt", null, row.labelDe), el("dd", null, row.text)])),
      calculationDetails(scale),
    ),
    canRetake
      ? card(
          { class: "card-warn" },
          el("p", { class: "card-title" }, "Der Sprechteil ist noch nicht ganz gemessen"),
          el("p", null, "Das zählt nicht als Fehler. Wiederhole die offenen Aufgaben, wenn du Ruhe hast. Du musst nur diesen Teil noch einmal machen."),
        )
      : null,
    plan?.noteDe ? card(el("p", { class: "card-title" }, "Dein Lernplan"), el("p", null, plan.noteDe)) : null,
    listCard("Das kannst du schon", attempt.strengths),
    listCard("Hier fehlt noch etwas", attempt.gaps),
    comparisonCard(attempts),
    bottomBar(
      canRetake ? button("Sprechteil wiederholen", () => startRetake(view, attempt), { kind: "primary" }) : null,
      barRow(continueButton(ctx, canRetake ? "secondary" : "primary"), backButton(ctx)),
    ),
  );
}

async function finish(view, session) {
  const { ctx, container } = view;
  draw(view, testHeader(ctx), waitNote("Dein Ergebnis wird berechnet …"));
  session.attemptAt ??= ctx.now().toISOString();
  ctx.store.saveSession(session);
  let content;
  try {
    content = await ctx.getContent(); // Nur der Lernplan braucht die Inhaltsdaten, die Antworten stehen schon in der Sitzung.
  } catch {
    if (container.isConnected) {
      showLoadFailed(view, () => finish(view, session));
    }
    return;
  }
  if (!container.isConnected) {
    return;
  }
  const attempt = attemptFrom(session);
  storeAttempt(ctx.state, attempt, buildPlan(attempt, content));
  ctx.save();
  ctx.store.clearSession();
  await showResult(view, attempt);
}

// ---------- Ablauf ----------

function run(view, session) {
  view.step?.destroy();
  view.step = null;
  const item = currentItem(session);
  if (!item) {
    finish(view, session);
  } else if (item.part === "listening") {
    showListening(view, session, item);
  } else if (item.part === "writing") {
    showWriting(view, session, item);
  } else {
    showSpeaking(view, session, item);
  }
}

async function startWith(view, createSession, formId) {
  const { ctx, container } = view;
  draw(view, testHeader(ctx), waitNote());
  let form;
  try {
    form = await loadFormSnapshot(ctx, formId);
  } catch {
    if (container.isConnected) {
      showLoadFailed(view, () => startWith(view, createSession, formId));
    }
    return;
  }
  if (!container.isConnected) {
    return; // Inzwischen ist eine andere Ansicht offen.
  }
  const session = createSession(form);
  ctx.store.saveSession(session); // Der Speicher hat nur einen Platz. Eine andere Übung wird hier ersetzt, ihre Wertung steht schon im Lernstand.
  run(view, session);
}

function startFresh(view) {
  const { ctx } = view;
  return startWith(view, (form) => createPlacementSession({ form, appVersion: ctx.version }), chooseForm(ctx.state.placement.attempts));
}

function startRetake(view, attempt) {
  const { ctx } = view;
  return startWith(view, (form) => createRetakeSession({ form, attempt, appVersion: ctx.version }), attempt.form);
}

function restart(view, session) {
  const { ctx } = view;
  ctx.store.clearSession();
  const attempt = session.retake ? ctx.state.placement.attempts.find((entry) => entry.at === session.attemptAt) : null;
  return speakingOpen(attempt) ? startRetake(view, attempt) : startFresh(view);
}

function whereText(session) {
  const item = currentItem(session);
  if (!item) {
    return "Du hast alle Aufgaben beantwortet. Es fehlt nur noch das Ergebnis.";
  }
  return "Du warst bei „" + PART_LABELS[item.part] + "“. Deine bisherigen Antworten sind gespeichert.";
}

function showResumeQuestion(view, session) {
  const { ctx } = view;
  draw(
    view,
    testHeader(ctx),
    card(
      el("h2", { class: "card-title" }, session.retake ? "Dein Sprechteil ist noch offen" : "Dein Test ist noch offen"),
      el("p", null, whereText(session)),
    ),
    bottomBar(button("Weitermachen", () => run(view, session), { kind: "primary" }), button("Neu beginnen", () => restart(view, session))),
  );
}

function lastAttemptCard(view, attempt) {
  return card(
    el("p", { class: "card-title" }, "Dein letzter Test"),
    el("p", null, "Am " + formatDate(attempt.at) + ": " + overallText(attempt) + ". Das ist eine grobe Orientierung."),
    button("Ergebnis ansehen", () => showResult(view, attempt)),
    speakingOpen(attempt) ? button("Sprechteil wiederholen", () => startRetake(view, attempt)) : null,
  );
}

function showIntro(view) {
  const { ctx } = view;
  const { attempts } = ctx.state.placement;
  draw(
    view,
    testHeader(ctx),
    card(
      el("h2", { class: "card-title" }, attempts.length > 0 ? "Mach den Test noch einmal" : "Wo stehst du gerade?"),
      el("p", null, "Der Test dauert etwa 10 Minuten. Erst hörst du, dann schreibst du, zum Schluss sprichst du."),
      hint(ROUGH_TEXT),
      el("p", null, "Für den Sprechteil brauchst du Kopfhörer und einen ruhigen Ort. Dort wirst du nach dem Mikrofon gefragt."),
      el("p", { class: "muted" }, "Du kannst jederzeit aufhören und später weitermachen. An dem, was du schon geübt hast, ändert der Test nichts."),
      attempts.length > 0 ? el("p", { class: "muted" }, "Diesmal kommen andere Sätze.") : null,
    ),
    attempts.length > 0 ? lastAttemptCard(view, attempts.at(-1)) : null,
    bottomBar(button("Test starten", () => startFresh(view), { kind: "primary" }), backButton(ctx)),
  );
}

export async function render(container, ctx) {
  const view = { container, ctx, step: null };
  const stored = ctx.store.loadSession();
  if (!sessionUsable(stored, ctx.version)) {
    showIntro(view);
  } else if (stored.resumeOnLoad) {
    stored.resumeOnLoad = false;
    ctx.store.saveSession(stored);
    run(view, stored); // Kommt allein aus der Sitzung, ohne Inhaltsdaten.
  } else {
    showResumeQuestion(view, stored);
  }
  return () => {
    view.step?.destroy();
    view.step = null;
    ctx.tts.cancel();
  };
}
