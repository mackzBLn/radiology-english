/*
 * Lernstand: Aufbau, Einheiten, Vollständigkeit. Unbekannte Felder und IDs bleiben immer erhalten.
 * Quellen:
 *   https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/hasOwn
 *   https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toISOString
 */

import { isDateString } from "./dates.js";

export const FORMAT_VERSION = 1;

const BOX_LIMIT = 5;
const COUNTERS = ["seen", "correct", "wrong"];

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function emptyParts() {
  return {
    units: {},
    placement: { attempts: [], plan: null },
    partner: [],
    settings: { voiceURI: null, lang: "en-GB", slowRate: 0.6 },
    backup: { lastAt: null },
    stats: { days: {} },
  };
}

export function createState(now) {
  const at = now.toISOString();
  return { formatVersion: FORMAT_VERSION, createdAt: at, updatedAt: at, ...emptyParts() };
}

export function newUnit() {
  return {
    box: 0,
    due: null,
    seen: 0,
    correct: 0,
    wrong: 0,
    lastResult: null,
    lastAt: null,
    spokenA: false,
    spokenB: false,
  };
}

// Eine Kopie, vorhandene oder neue. state bleibt unberührt, gespeichert wird erst mit setUnitState.
export function unitState(state, id) {
  const known = Object.hasOwn(state.units, id) ? state.units[id] : null;
  return { ...newUnit(), ...known };
}

export function setUnitState(state, id, unit) {
  state.units[id] = unit;
}

// Ergänzt fehlende Bereiche und Felder mit den Vorgaben. Vorhandenes und Unbekanntes bleibt, falsche Typen auch:
// Die meldet danach stateProblem.
export function withDefaults(state) {
  const parts = emptyParts();
  const complete = { ...parts, ...state };
  for (const key of ["placement", "settings", "backup", "stats"]) {
    if (isPlainObject(state[key])) {
      complete[key] = { ...parts[key], ...state[key] };
    }
  }
  return complete;
}

export function unitProblem(id, unit) {
  if (!isPlainObject(unit)) {
    return "Einheit " + id + " ist kein Objekt";
  }
  if (unit.box !== undefined && !(Number.isInteger(unit.box) && unit.box >= 0 && unit.box <= BOX_LIMIT)) {
    return "Einheit " + id + " hat eine ungültige Box";
  }
  if (unit.due !== undefined && unit.due !== null && !isDateString(unit.due)) {
    return "Einheit " + id + " hat ein ungültiges Datum";
  }
  for (const counter of COUNTERS) {
    const value = unit[counter];
    if (value !== undefined && !(Number.isInteger(value) && value >= 0)) {
      return "Einheit " + id + " hat einen ungültigen Zähler";
    }
  }
  return null;
}

// Verschiebt kaputte Einheiten nach state.quarantine.units, damit der Rest nutzbar bleibt und nichts verloren geht.
// Ändert state und liefert die Zahl der verschobenen Einheiten.
export function quarantineBrokenUnits(state) {
  if (!isPlainObject(state) || !isPlainObject(state.units)) {
    return 0;
  }
  const broken = Object.entries(state.units).filter(([id, unit]) => unitProblem(id, unit));
  if (broken.length === 0) {
    return 0;
  }
  const quarantine = isPlainObject(state.quarantine) ? state.quarantine : {};
  const units = isPlainObject(quarantine.units) ? quarantine.units : {};
  for (const [id, unit] of broken) {
    units[id] = unit;
    delete state.units[id];
  }
  state.quarantine = { ...quarantine, units };
  return broken.length;
}

// Prüft den Aufbau nach withDefaults. Liefert den ersten Mangel als Text oder null.
export function stateProblem(state) {
  if (!isPlainObject(state)) {
    return "Der Lernstand ist kein Objekt";
  }
  if (!Number.isInteger(state.formatVersion)) {
    return "Die Formatversion fehlt";
  }
  for (const key of ["createdAt", "updatedAt"]) {
    if (state[key] !== undefined && typeof state[key] !== "string") {
      return "Das Feld " + key + " ist keine Zeitangabe";
    }
  }
  if (!isPlainObject(state.units)) {
    return "Die Einheiten fehlen";
  }
  for (const [id, unit] of Object.entries(state.units)) {
    const problem = unitProblem(id, unit);
    if (problem) {
      return problem;
    }
  }
  if (!isPlainObject(state.placement) || !Array.isArray(state.placement.attempts)) {
    return "Die Einstufung ist beschädigt";
  }
  if (state.placement.plan !== null && !isPlainObject(state.placement.plan)) {
    return "Der Lernplan ist beschädigt";
  }
  if (!Array.isArray(state.partner)) {
    return "Die Partnerübungen sind beschädigt";
  }
  if (!isPlainObject(state.settings)) {
    return "Die Einstellungen sind beschädigt";
  }
  if (!isPlainObject(state.backup)) {
    return "Der Sicherungsvermerk ist beschädigt";
  }
  if (!isPlainObject(state.stats) || !isPlainObject(state.stats.days)) {
    return "Die Statistik ist beschädigt";
  }
  return null;
}
