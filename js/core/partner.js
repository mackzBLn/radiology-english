/*
 * Bewertung nach einem Rollenspiel: Bestanden oder nicht, und welche Einheiten deshalb wiederkommen.
 * Eine Bewertung: { caseId, exam, type, at, ratings: { "fa.check.1": "yes"|"partly"|"no", ... }, helpNote, passed }.
 * Ein Punkt ohne Bewertung sagt nichts über Schwächen, zum Bestehen fehlt er aber.
 * Was zurückkommt, wird verteilt: je Tag höchstens RATING_UNITS_PER_DAY, die Kernsätze zuerst. Eine schwache Bewertung kann sonst rund 90 Einheiten
 * auf einmal fällig machen, und eine Runde in der Bahn nimmt höchstens 21 davon.
 */

import { addDays } from "./dates.js";
import { setUnitState, unitState } from "./state.js";

const CHECKS_TO_CONFIRM = ["fa.check.1", "fa.check.2", "fa.check.3", "fa.check.4"];
const CHECK_HELP = "fa.check.5";
const SAFETY_SCENARIOS = ["safety", "greeting"];

export const RATING_UNITS_PER_DAY = 15;

export function ratingPassed(ratings) {
  return CHECKS_TO_CONFIRM.every((check) => ratings?.[check] === "yes") && ratings?.[CHECK_HELP] === "no";
}

function examOf(rating, content) {
  return rating.exam ?? content.cases.find((item) => item.id === rating.caseId)?.exam ?? null;
}

function sectionUnitIds(content, ...sectionIds) {
  return content
    .sections()
    .filter((section) => sectionIds.includes(section.id))
    .flatMap((section) => section.unitIds);
}

// Die IDs, die wiederkommen, ohne Dubletten.
export function weakUnitsFromRating(rating, content) {
  const ratings = rating.ratings ?? {};
  const isWeak = (check) => ratings[check] !== undefined && ratings[check] !== "yes";
  const examScenarios = content.examSections(examOf(rating, content));
  const ids = [];

  if (isWeak("fa.check.1")) {
    const scenarios = examScenarios.filter((section) => SAFETY_SCENARIOS.includes(section.key));
    ids.push(...scenarios.flatMap((section) => section.unitIds).filter((id) => content.unit(id)?.core === true && content.unit(id).type === "sentence"));
  }
  if (isWeak("fa.check.2")) {
    ids.push(...examScenarios.flatMap((section) => section.unitIds).filter((id) => content.unit(id)?.type === "patient"));
  }
  if (isWeak("fa.check.3")) {
    ids.push(...sectionUnitIds(content, "kl.repeat", "kl.confirm"));
  }
  if (isWeak("fa.check.4")) {
    ids.push(...sectionUnitIds(content, "kl.teachback"));
  }
  if (ratings[CHECK_HELP] !== undefined && ratings[CHECK_HELP] !== "no") {
    ids.push(...sectionUnitIds(content, "kl.rescue"));
  }
  return [...new Set(ids)];
}

// Kernsätze zuerst, sonst bleibt die Reihenfolge der Bewertung.
function byImportance(ids, content) {
  const isCore = (id) => content.unit(id)?.core === true;
  return [...ids.filter(isCore), ...ids.filter((id) => !isCore(id))];
}

// Der Tag für die Einheit an dieser Stelle. Was vorher dran wäre, rückt nicht nach hinten, Überfälliges kommt heute.
function dueFor(unit, index, today) {
  const planned = addDays(today, Math.floor(index / RATING_UNITS_PER_DAY));
  if (typeof unit.due !== "string" || unit.due >= planned) {
    return planned;
  }
  return unit.due < today ? today : unit.due;
}

// Speichert die Bewertung und plant die IDs ein. Alles andere an den Einheiten bleibt. Liefert den Eintrag.
export function applyRating(state, rating, content, today) {
  const entry = { ...rating, passed: ratingPassed(rating.ratings) };
  state.partner.push(entry);
  byImportance(weakUnitsFromRating(rating, content), content).forEach((id, index) => {
    const unit = unitState(state, id);
    setUnitState(state, id, { ...unit, due: dueFor(unit, index, today) });
  });
  return entry;
}
