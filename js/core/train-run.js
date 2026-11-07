/*
 * Ablauf einer Bahn-Runde ohne DOM: Warteschlange, Uhr, Wertung, Rückmeldung, Zusammenfassung.
 * Zeit, Zufall und Speichern kommen als Parameter. Die Ansicht liest nur, was hier steht.
 *
 * Runde: { focus, queue, index, clock, newUnitIds, metNewIds, tally, hearingStarted }
 *   queue    Liste aus { exercise, retry, result }. exercise kommt aus planTrain, retry heißt: zweiter Versuch in dieser Runde.
 *   clock    { doneMs, runningSince }: Die Uhr steht, solange die Ansicht sie anhält (runningSince null).
 *   tally    { right, wrong, hinted, rightOnRetry }: right, wrong und hinted zählen nur erste Versuche.
 *            So zählt ein zweiter falscher Versuch nicht als neuer Fehler in der Anzeige.
 */

import { normalizeText, surfaceWords } from "./normalize.js";
import { applyResult, isNew, recordExercise } from "./srs.js";
import { setUnitState, unitState } from "./state.js";

export const ROUND_LIMIT_MS = 18 * 60 * 1000;
// So viele andere Übungen liegen zwischen einer falschen Antwort und ihrem zweiten Versuch.
export const RETRY_GAP = 3;
export const HINT_STEPS = 3;

const HEARING_KINDS = new Set(["present", "hearReact", "hearMeaning", "wordHear"]);
const ENGLISH_OPTION_KINDS = new Set(["pickEnglish", "wordPick", "hearReact"]);
const SHUFFLED_OPTION_KINDS = new Set(["pickEnglish", "wordPick", "hearReact", "hearMeaning", "wordHear"]);

// ----- Runde -----

/*
 * Ein Satz, der fällig ist, aber noch nie geübt wurde, kommt aus einer Partner-Bewertung. Wie jeder neue Satz kommt er erst zum Hören und Lesen.
 * Das steht hier und nicht im Plan, denn planTrain plant je fällige Einheit genau eine Übung.
 */
function withFirstSight(plan, state) {
  return plan.flatMap((exercise, index) => {
    const progress = unitState(state, exercise.unitId);
    const shownBefore = plan[index - 1]?.kind === "present" && plan[index - 1].unitId === exercise.unitId;
    const unseen = exercise.kind === "pickEnglish" && !isNew(progress) && (progress.seen ?? 0) === 0 && !shownBefore;
    return unseen ? [{ unitId: exercise.unitId, kind: "present", options: [] }, exercise] : [exercise];
  });
}

export function createRun({ plan, state, focus = null, now }) {
  const newUnitIds = [...new Set(plan.map((exercise) => exercise.unitId))].filter((id) => isNew(unitState(state, id)));
  return {
    focus,
    queue: withFirstSight(plan, state).map((exercise) => ({ exercise, retry: false, result: null })),
    index: 0,
    clock: { doneMs: 0, runningSince: now.getTime() },
    newUnitIds,
    metNewIds: [],
    tally: { right: 0, wrong: 0, hinted: 0, rightOnRetry: 0 },
    hearingStarted: false,
  };
}

export function currentItem(run) {
  return run.queue[run.index];
}

// Etwas ist schon passiert. Vorher lohnt keine Rückfrage beim Verlassen.
export function hasProgress(run) {
  return run.index > 0 || currentItem(run).result !== null;
}

function markMet(run, unitId) {
  if (run.newUnitIds.includes(unitId) && !run.metNewIds.includes(unitId)) {
    run.metNewIds.push(unitId);
  }
}

// ----- Uhr -----

export function elapsedMs(run, now) {
  const { doneMs, runningSince } = run.clock;
  return doneMs + (runningSince === null ? 0 : Math.max(0, now.getTime() - runningSince));
}

export function pauseClock(run, now) {
  run.clock.doneMs = elapsedMs(run, now);
  run.clock.runningSince = null;
}

export function resumeClock(run, now) {
  if (run.clock.runningSince === null) {
    run.clock.runningSince = now.getTime();
  }
}

export function isOverTime(run, now) {
  return elapsedMs(run, now) >= ROUND_LIMIT_MS;
}

export function formatClock(ms) {
  const seconds = Math.floor(ms / 1000);
  const pad = (value) => String(value).padStart(2, "0");
  return pad(Math.floor(seconds / 60)) + ":" + pad(seconds % 60);
}

// ----- Weiter -----

export function hasNext(run, now) {
  return run.index + 1 < run.queue.length && !isOverTime(run, now);
}

// Zur nächsten Übung. false heißt: Die Runde ist zu Ende, weil nichts mehr da oder die Zeit um ist.
export function advance(run, now) {
  const { exercise } = currentItem(run);
  if (exercise.kind === "present") {
    markMet(run, exercise.unitId);
  }
  if (isHearing(exercise)) {
    run.hearingStarted = true;
  }
  if (!hasNext(run, now)) {
    return false;
  }
  run.index += 1;
  return true;
}

// ----- Ton -----

export function isHearing(exercise) {
  return HEARING_KINDS.has(exercise.kind);
}

// Die erste Hörübung einer Runde startet per Tipp auf „Anhören“.
export function isFirstHearing(run) {
  return isHearing(currentItem(run).exercise) && !run.hearingStarted;
}

// Jede weitere spricht von selbst, direkt im Tipp auf „Weiter“ (Gerätetest Lauf 1).
export function speaksBySelf(run) {
  return isHearing(currentItem(run).exercise) && run.hearingStarted;
}

// ----- Ergebnis einer Antwort -----

export function choiceResult(option) {
  return option.correct === true ? "ok" : "wrong";
}

// outcome aus matchTyped: close zählt als richtig. Wer den Hinweis genutzt hat, bekommt hint statt ok.
export function typedResult(outcome, hintUsed) {
  if (outcome === "wrong") {
    return "wrong";
  }
  return hintUsed ? "hint" : "ok";
}

/*
 * Was eine getippte Antwort in der Bahn zählt, aus dem Ergebnis von matchTyped. Kippt der Sinn, weil ein not fehlt oder dazukommt,
 * ist sie falsch, auch wenn der Abgleich sie fast richtig nennt: Bei Sicherheitssätzen ist das das Gegenteil des Ziels.
 */
export function typedAnswer(match, hintUsed) {
  const negationFlip = match.negationFlip === true;
  const outcome = negationFlip ? "wrong" : match.outcome;
  const close = outcome === "close";
  return { result: typedResult(outcome, hintUsed), close, negationFlip, against: close || negationFlip ? match.against : null };
}

// Der Großbuchstabe verriete beim Satzlegen das erste Wort. I und Abkürzungen bleiben, wie sie sind.
const KEEPS_CAPITAL = /^(I|I['’].*|Mr|Mrs|Ms|Dr)$/;

function lowerFirst(word) {
  return KEEPS_CAPITAL.test(word) || word.slice(1) !== word.slice(1).toLowerCase() ? word : word.slice(0, 1).toLowerCase() + word.slice(1);
}

// Die Wörter der Kacheln, in der Folge der Übung. Gewertet wird ohne Rücksicht auf die Schreibung (builtResult).
export function tileWords(exercise) {
  return exercise.options.map((option) => (option.text === exercise.answer[0] ? lowerFirst(option.text) : option.text));
}

// Alle Wörter sind gelegt. Richtig ist die Folge der Übung und jede Fassung der Einheit, die sich aus den Wörtern legen lässt.
export function builtResult(exercise, unit, words) {
  const built = normalizeText(words.join(" "));
  const forms = [exercise.answer.join(" "), unit.en, ...(unit.variants ?? [])];
  return forms.some((form) => normalizeText(form) === built) ? "ok" : "wrong";
}

// ----- Wertung -----

function shuffled(list, rng) {
  const result = [...list];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.min(Math.floor(rng() * (index + 1)), index);
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

// Ein neuer Satz und seine Übung bleiben beieinander, der zweite Versuch rückt nicht dazwischen.
function retryPosition(run) {
  const position = Math.min(run.index + 1 + RETRY_GAP, run.queue.length);
  const before = run.queue[position - 1];
  return before.exercise.kind === "present" && position < run.queue.length ? position + 1 : position;
}

function queueRetry(run, item, rng) {
  const { exercise } = item;
  const options = SHUFFLED_OPTION_KINDS.has(exercise.kind) ? shuffled(exercise.options, rng) : exercise.options;
  run.queue.splice(retryPosition(run), 0, { exercise: { ...exercise, options }, retry: true, result: null });
}

function count(run, item, result) {
  const { tally } = run;
  if (item.retry) {
    tally.rightOnRetry += result === "wrong" ? 0 : 1;
  } else if (result === "ok") {
    tally.right += 1;
  } else if (result === "hint") {
    tally.hinted += 1;
  } else {
    tally.wrong += 1;
  }
}

/*
 * Wertet die laufende Übung genau einmal: applyResult, recordExercise, dann speichern. save schreibt den Lernstand.
 * present zählt nicht als Abruf und ändert nichts. Liefert true, wenn gewertet wurde.
 * Falsches kommt in dieser Runde einmal wieder, ein zweiter Versuch kommt nicht noch einmal.
 */
export function gradeAnswer({ run, state, result, today, now, rng, save }) {
  const item = currentItem(run);
  if (item.exercise.kind === "present" || item.result !== null) {
    return false;
  }
  const { unitId } = item.exercise;
  setUnitState(state, unitId, applyResult(unitState(state, unitId), result, today, now));
  recordExercise(state, today);
  item.result = result;
  markMet(run, unitId);
  count(run, item, result);
  if (result === "wrong" && !item.retry) {
    queueRetry(run, item, rng);
  }
  save();
  return true;
}

// ----- Rückmeldung -----

export function optionsAreEnglish(kind) {
  return ENGLISH_OPTION_KINDS.has(kind);
}

/*
 * Was die Rückmeldung zeigt. sentence ist die Einheit, bei hearReact also die gehörte Äußerung, dazu kommt reaction, die passende Antwort.
 * against: die Fassung, der eine fast richtig getippte Antwort am nächsten kam. Dann zeigt die Ansicht genau diese.
 */
export function feedbackFor({ exercise, unit, chosen = null, against = null }) {
  const wrong = chosen && chosen.correct !== true ? chosen : null;
  const fitting = exercise.kind === "hearReact" ? (wrong ? exercise.options.find((option) => option.correct === true) : chosen) ?? null : null;
  return {
    sentence: { en: against ?? unit.en, meaningDe: unit.meaningDe, source: unit.source },
    reaction: fitting ? { en: fitting.text, meaningDe: fitting.meaningDe ?? null, source: fitting.source ?? null } : null,
    wrongChoice: wrong
      ? {
          text: wrong.text,
          english: optionsAreEnglish(exercise.kind),
          meaningDe: wrong.meaningDe ?? null,
          whyDe: wrong.whyDe ?? null,
          source: wrong.source ?? null,
        }
      : null,
    noteDe: unit.noteDe ?? null,
    clinic: unit.clinicDependent === true || fitting?.clinicDependent === true,
  };
}

// label steht über dem englischen Satz, closing am Ende der Karte. comesAgain: Der zweite Versuch kommt noch in dieser Runde.
export function verdictOf(result, { close = false, comesAgain = false } = {}) {
  const exactly = close ? "So heißt der Satz genau:" : null;
  if (result === "ok") {
    return { tone: "ok", title: close ? "Fast richtig, das zählt" : "Richtig", label: exactly, closing: null };
  }
  if (result === "hint") {
    return { tone: "warn", title: close ? "Fast richtig, mit Hinweis" : "Richtig, mit Hinweis", label: exactly, closing: "Der Satz kommt morgen wieder." };
  }
  return {
    tone: "error",
    title: comesAgain ? "Noch nicht richtig, kommt gleich nochmal" : "Noch nicht richtig, kommt morgen wieder",
    label: "Richtig ist:",
    closing: comesAgain ? "Das kommt gleich noch einmal." : "Das kommt morgen wieder.",
  };
}

// Die Aufgabe bei den Übungen mit Antworten zum Antippen. text: was dazu auf dem Bildschirm steht.
export function promptOf(kind, unit) {
  switch (kind) {
    case "hearReact":
      return { label: "Hör zu. Was antwortest du?", text: null };
    case "hearMeaning":
      return { label: "Hör zu. Was bedeutet der Satz?", text: null };
    case "wordHear":
      return { label: "Hör zu. Was bedeutet das Wort?", text: null };
    case "wordPick":
      return { label: "Welches Wort passt?", text: unit.meaningDe };
    default:
      return { label: "Was sagst du?", text: unit.situationDe };
  }
}

// ----- Hinweis beim Tippen -----

function maskWord(word, shownLetters) {
  let left = shownLetters;
  return [...word]
    .map((char) => {
      if (!/[\p{L}\p{N}]/u.test(char)) {
        return char;
      }
      left -= 1;
      return left >= 0 ? char : "_";
    })
    .join("");
}

function letterCount(word) {
  return [...word].filter((char) => /[\p{L}\p{N}]/u.test(char)).length;
}

// Schritt 1 bis HINT_STEPS, jeder zeigt mehr als der davor: textDe sagt, was es ist, en ist der Teil des Satzes.
export function typingHint(en, step) {
  const words = surfaceWords(en);
  if (step <= 1) {
    const size = words.length === 1 ? "1 Wort" : words.length + " Wörter";
    return { textDe: size + ". So beginnt der Satz:", en: words[0] + " …" };
  }
  if (step === 2) {
    return { textDe: "Die Anfangsbuchstaben:", en: words.map((word) => maskWord(word, 1)).join(" ") };
  }
  return {
    textDe: "Jedes Wort zur Hälfte:",
    en: words.map((word) => maskWord(word, Math.ceil(letterCount(word) / 2))).join(" "),
  };
}

// ----- Zusammenfassung -----

export function summaryOf(run, now) {
  const { right, wrong, hinted, rightOnRetry } = run.tally;
  return {
    right,
    wrong,
    hinted,
    rightOnRetry,
    fresh: run.metNewIds.length,
    elapsedMs: elapsedMs(run, now),
    answered: right + wrong + hinted,
    comesBack: wrong + hinted,
  };
}
