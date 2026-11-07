/*
 * Wiederholung in Abständen: Box 0 bis 5, jede richtige Antwort eine Box höher, jede schwache zurück auf 0.
 * Zeit kommt als Parameter, die Tests warten auf keinen echten Tag.
 * Quelle: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/hasOwn
 */

import { addDays } from "./dates.js";
import { newUnit } from "./state.js";

export const INTERVALS = [1, 3, 7, 14, 30];

const BOX_LIMIT = INTERVALS.length;
const WEAK_RESULTS = ["hint", "wrong", "notUnderstood"];
const COUNTED_AS_WRONG = ["wrong", "notUnderstood"];

/*
 * Liefert eine neue Einheit, die übergebene bleibt unverändert, unbekannte Felder bleiben erhalten.
 * Der Tag der nächsten Wiederholung gehört zur neuen Box: Box 1 in 1 Tag, Box 5 in 30 Tagen.
 * spokenA und spokenB setzt die Ansicht, denn nur sie kennt die Stufe.
 */
export function applyResult(unit, result, today, now) {
  const base = { ...newUnit(), ...unit };
  const seen = base.seen + 1;
  if (result === "notMeasured") {
    return { ...base, seen };
  }
  const at = now.toISOString();
  if (result === "ok") {
    const box = Math.min(base.box + 1, BOX_LIMIT);
    return {
      ...base,
      box,
      due: addDays(today, INTERVALS[box - 1]),
      seen,
      correct: base.correct + 1,
      lastResult: result,
      lastAt: at,
    };
  }
  if (!WEAK_RESULTS.includes(result)) {
    throw new RangeError("Unbekanntes Ergebnis: " + result);
  }
  return {
    ...base,
    box: 0,
    due: addDays(today, 1),
    seen,
    wrong: base.wrong + (COUNTED_AS_WRONG.includes(result) ? 1 : 0),
    lastResult: result,
    lastAt: at,
  };
}

export function isDue(unit, today) {
  return typeof unit.due === "string" && unit.due <= today;
}

// Neu heißt: noch keine Wertung. seen zählt nicht, denn notMeasured erhöht es, und die Einheit muss trotzdem wiederkommen.
export function isNew(unit) {
  return unit.due === null || unit.due === undefined;
}

export function isWeak(unit) {
  return WEAK_RESULTS.includes(unit.lastResult);
}

export function isLearned(contentUnit, unit) {
  return contentUnit.type === "sentence" ? unit.spokenB === true : unit.box >= 2;
}

export function recordExercise(state, today) {
  const days = state.stats.days;
  const day = Object.hasOwn(days, today) ? days[today] : {};
  days[today] = { ...day, exercises: (day.exercises ?? 0) + 1 };
}
