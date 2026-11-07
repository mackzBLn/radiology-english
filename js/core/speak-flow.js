/*
 * Ablauf der Sprechübung ohne DOM: Sitzung, Schritte, einmalige Wertung, Zusammenfassung. Zeit und Speichern kommen als Parameter.
 *
 * Sitzung: { kind: "speech", appVersion, focus, queue, index, step, result, graded, seenBefore, tally }
 *   queue    Liste aus planSpeech: { unitId, stage, snapshot }
 *   step     listen (noch nicht angehört), speak (bereit zum Sprechen), feedback (Ergebnis da), failed (Ausfall)
 *   result   { outcome, transcript, words, against, reason } oder null. outcome: understood, partly, notUnderstood, notMeasured
 *   graded   Das Ergebnis steht im Lernstand. seenBefore: seen der Einheit vor der Wertung.
 *
 * Genau einmal werten: Lernstand und Sitzung sind zwei Schreibvorgänge, dazwischen kann die App enden. seen steigt bei jeder
 * Wertung, auch bei notMeasured (srs.js). Steht seen über seenBefore, ist die Wertung schon im Lernstand angekommen.
 */

import { applyResult, recordExercise } from "./srs.js";
import { setUnitState, unitState } from "./state.js";

export const SESSION_KIND = "speech";

const STEPS = ["listen", "speak", "feedback", "failed"];

const LEARNING_RESULT = { understood: "ok", partly: "hint", notUnderstood: "notUnderstood", notMeasured: "notMeasured" };

// ----- Schritte -----

// Gibt es etwas zum Anhören, kommt das zuerst. Stufe b ohne Patientenäußerung beginnt gleich mit dem Sprechen.
export function initialStep(task) {
  return task.stage === "a" || task.snapshot.prompt ? "listen" : "speak";
}

export function stepAfterResult(result) {
  return result.outcome === "notMeasured" ? "failed" : "feedback";
}

// heard ist das Ergebnis von recognizer.listen, assess bewertet den Text. Alles daran lässt sich in der Sitzung speichern.
export function resultFromHearing(heard, assess) {
  if (heard.status !== "heard") {
    return { outcome: "notMeasured", transcript: "", words: [], against: null, reason: heard.reason ?? null };
  }
  const assessment = assess(heard.transcript);
  return {
    outcome: assessment.outcome,
    transcript: heard.transcript,
    words: assessment.words,
    against: assessment.against ?? null,
    reason: null,
    ...(assessment.negationFlip ? { negationFlip: true } : {}),
  };
}

// „Weiß ich nicht“: Sie sieht den Satz und er kommt wieder, wertet also wie notUnderstood. Es lief keine Erkennung, darum gibt es keine Wörter.
export const DONT_KNOW = "dontKnow";

export function dontKnowResult() {
  return { outcome: "notUnderstood", transcript: "", words: [], against: null, reason: DONT_KNOW };
}

// ----- Sitzung -----

export function createSpeechSession({ queue, focus = null, appVersion }) {
  return {
    kind: SESSION_KIND,
    appVersion,
    focus: focus ?? null,
    queue,
    index: 0,
    step: initialStep(queue[0]),
    result: null,
    graded: false,
    seenBefore: null,
    tally: { understood: 0, partly: 0, notUnderstood: 0, notMeasured: 0 },
  };
}

function usableTask(task) {
  return typeof task?.unitId === "string" && (task.stage === "a" || task.stage === "b") && typeof task.snapshot?.en === "string";
}

// Passt die gespeicherte Übung zu dieser Route und dieser Version der App? Sonst beginnt eine neue.
export function sessionFits(session, { focus = null, appVersion }) {
  if (session?.kind !== SESSION_KIND || session.appVersion !== appVersion || (session.focus ?? null) !== (focus ?? null)) {
    return false;
  }
  if (!Array.isArray(session.queue) || !usableTask(session.queue[session.index]) || !STEPS.includes(session.step)) {
    return false;
  }
  const hasResult = session.step === "feedback" || session.step === "failed";
  return !hasResult || typeof session.result?.outcome === "string";
}

export function currentTask(session) {
  return session.queue[session.index];
}

export function stepStateOf(session) {
  return { step: session.step, result: session.result };
}

// Ohne Ergebnis gibt es auch nichts, das schon gewertet wäre. So zählt nach einem Ausfall der nächste Versuch neu.
export function setStepState(session, { step, result }) {
  session.step = step;
  session.result = result;
  if (result === null) {
    session.graded = false;
    session.seenBefore = null;
  }
}

// Zum nächsten Satz. false heißt: Es war der letzte, die Sitzung bleibt unverändert.
export function advance(session) {
  const next = session.index + 1;
  if (next >= session.queue.length) {
    return false;
  }
  session.index = next;
  setStepState(session, { step: initialStep(session.queue[next]), result: null });
  return true;
}

// ----- Wertung -----

export function needsGrading(session) {
  return Boolean(session.result) && !session.graded;
}

function applyToLearning({ state, task, outcome, today, now }) {
  const unit = applyResult(unitState(state, task.unitId), LEARNING_RESULT[outcome], today, now);
  if (outcome === "understood") {
    unit[task.stage === "a" ? "spokenA" : "spokenB"] = true;
  }
  setUnitState(state, task.unitId, unit);
  if (outcome !== "notMeasured") {
    recordExercise(state, today);
  }
}

/*
 * Wertet das Ergebnis der Sitzung genau einmal und speichert sofort. Darf beliebig oft laufen, auch nach einem Neuladen.
 * saveState schreibt den Lernstand, saveSession die Sitzung. Liefert true, wenn die Sitzung dadurch als gewertet gilt.
 */
export function gradeOnce({ session, state, today, now, saveState, saveSession }) {
  if (!needsGrading(session)) {
    return false;
  }
  const task = currentTask(session);
  const seen = unitState(state, task.unitId).seen;
  if (session.seenBefore === null || session.seenBefore === undefined) {
    session.seenBefore = seen;
    saveSession(session);
  }
  if (seen === session.seenBefore) {
    applyToLearning({ state, task, outcome: session.result.outcome, today, now });
    saveState();
  }
  session.tally[session.result.outcome] += 1;
  session.graded = true;
  saveSession(session);
  return true;
}

// ----- Zusammenfassung -----

export function summaryOf(session) {
  const { understood, partly, notUnderstood, notMeasured } = session.tally;
  return {
    spoken: understood + partly + notUnderstood,
    understood,
    partly,
    notUnderstood,
    notMeasured,
    comesBack: partly + notUnderstood,
  };
}
