/*
 * Liest ältere Lernstände. Eine Migration hebt das Format um genau eine Stufe:
 * MIGRATIONS[n] bekommt einen Stand im Format n und liefert ihn im Format n + 1.
 * Das Format 1 ist das erste, darum ist die Liste noch leer.
 * Quelle: https://developer.mozilla.org/en-US/docs/Web/API/Window/structuredClone
 */

import { FORMAT_VERSION, isPlainObject, stateProblem, withDefaults } from "./state.js";

export const MIGRATIONS = {};

export class FormatTooNewError extends Error {
  constructor(found, supported) {
    super("Format " + found + " ist neuer als das unterstützte Format " + supported);
    this.name = "FormatTooNewError";
    this.found = found;
    this.supported = supported;
  }
}

export class BrokenStateError extends Error {
  constructor(message) {
    super(message);
    this.name = "BrokenStateError";
  }
}

export function migrate(raw, { migrations = MIGRATIONS, target = FORMAT_VERSION } = {}) {
  if (!isPlainObject(raw)) {
    throw new BrokenStateError("Der Lernstand ist kein Objekt");
  }
  const from = raw.formatVersion;
  if (!Number.isInteger(from) || from < 0) {
    throw new BrokenStateError("Die Formatversion fehlt oder ist ungültig");
  }
  if (from > target) {
    throw new FormatTooNewError(from, target);
  }
  // Auf einer Kopie, damit die Eingabe unverändert bleibt.
  let state = structuredClone(raw);
  for (let version = from; version < target; version += 1) {
    const step = migrations[version];
    if (typeof step !== "function") {
      throw new BrokenStateError("Für das Format " + version + " gibt es keine Migration");
    }
    state = step(state);
    if (!isPlainObject(state)) {
      throw new BrokenStateError("Die Migration ab Format " + version + " liefert keinen Lernstand");
    }
    state.formatVersion = version + 1;
  }
  state = withDefaults(state);
  const problem = stateProblem(state);
  if (problem) {
    throw new BrokenStateError(problem);
  }
  return { state, migratedFrom: from === target ? null : from };
}
