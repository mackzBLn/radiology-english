/*
 * Sicherungsdatei des Lernstands: anlegen, benennen, prüfen und einlesen.
 * Quellen:
 *   https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse
 *   https://developer.mozilla.org/en-US/docs/Web/API/Window/structuredClone
 *   https://www.rfc-editor.org/rfc/rfc8259#section-8.1 (Byte-Reihenfolge-Marke)
 */

import { toDateString } from "./dates.js";
import { isPlainObject } from "./state.js";
import { FormatTooNewError, migrate } from "./migrate.js";

export const BACKUP_APP = "radiology-english";
export const BACKUP_KIND = "backup";

export function createBackup(state, { appVersion, now }) {
  return {
    app: BACKUP_APP,
    kind: BACKUP_KIND,
    formatVersion: state.formatVersion,
    createdAt: now.toISOString(),
    appVersion,
    state: structuredClone(state),
  };
}

export function backupFileName(now) {
  return "radiology-english-lernstand-" + toDateString(now) + ".json";
}

// Aufgehobene Rohdaten eines kaputten Stands als Datei. Das ist keine Sicherung, parseBackup lehnt sie ab.
export function createRawExport(items, { appVersion, now }) {
  return { app: BACKUP_APP, kind: "raw", createdAt: now.toISOString(), appVersion, items };
}

export function rawExportFileName(now) {
  return "radiology-english-rohdaten-" + toDateString(now) + ".json";
}

function rejected(reasonDe) {
  return { ok: false, reasonDe };
}

// options wie bei migrate; die App ruft parseBackup(text) ohne sie auf.
export function parseBackup(text, options = {}) {
  if (typeof text !== "string") {
    return rejected("Die Datei ließ sich nicht lesen.");
  }
  let data;
  try {
    // Eine Byte-Reihenfolge-Marke am Anfang darf ein Leser übergehen (RFC 8259), JSON.parse nimmt sie nicht an.
    data = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return rejected("Diese Datei ist beschädigt oder keine Sicherung. Wähle die Datei radiology-english-lernstand-….json.");
  }
  if (!isPlainObject(data) || data.app !== BACKUP_APP || data.kind !== BACKUP_KIND) {
    return rejected("Das ist keine Sicherung von Radiology English.");
  }
  if (!Number.isInteger(data.formatVersion) || data.formatVersion < 0) {
    return rejected("Die Sicherung nennt keine gültige Formatversion.");
  }
  if (!isPlainObject(data.state)) {
    return rejected("Die Sicherung enthält keinen Lernstand.");
  }
  if (data.state.formatVersion !== data.formatVersion) {
    return rejected("Die Formatversion der Sicherung passt nicht zu ihrem Inhalt.");
  }
  let result;
  try {
    result = migrate(data.state, options);
  } catch (error) {
    if (error instanceof FormatTooNewError) {
      return rejected(
        "Diese Sicherung stammt aus einer neueren Version der App (Format " + error.found +
        ", diese App liest bis Format " + error.supported + "). Aktualisiere zuerst die App.",
      );
    }
    return rejected("Der Lernstand in der Sicherung ist beschädigt: " + error.message + ".");
  }
  return {
    ok: true,
    state: result.state,
    info: {
      createdAt: data.createdAt ?? null,
      appVersion: data.appVersion ?? null,
      formatVersion: data.formatVersion,
      units: Object.keys(result.state.units).length,
      attempts: result.state.placement.attempts.length,
    },
  };
}
