/*
 * Sichern und Einlesen, dazu der Weg zu den aufgehobenen Ständen. Eine Datei entsteht nur auf Tipp, nichts verlässt das Gerät von selbst.
 * Quellen:
 *   https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share
 *   https://developer.mozilla.org/en-US/docs/Web/API/Navigator/canShare
 *   https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL_static
 *   https://developer.mozilla.org/en-US/docs/Web/API/Blob/text
 *   https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/file
 */

import { backupFileName, createBackup, createRawExport, parseBackup, rawExportFileName } from "../../core/backup.js";
import { backButton, barRow, bottomBar, button, card, confirmDialog, formatDate, hint, navButton, viewHeader } from "../components.js";
import { clear, el } from "../dom.js";

const REVOKE_AFTER_MS = 60000;
const REPLACE_NOTE = "Das ersetzt deinen jetzigen Lernstand. Dein jetziger Stand bleibt als Kopie erhalten.";

function download(file) {
  const url = URL.createObjectURL(file);
  const link = el("a", { href: url, download: file.name, class: "visually-hidden" });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}

// Teilen, wenn das Gerät es erlaubt, sonst Herunterladen. Der Aufruf von share bleibt direkt im Tipp.
// Nur NotAllowedError heißt: Teilen geht hier nicht. Andere Fehler laden nichts zusätzlich herunter.
async function deliver(file) {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return "shared";
    } catch (error) {
      if (error.name === "AbortError") {
        return "aborted";
      }
      if (error.name !== "NotAllowedError") {
        return "failed";
      }
    }
  }
  download(file);
  return "downloaded";
}

function jsonFile(data, name) {
  return new File([JSON.stringify(data, null, 2)], name, { type: "application/json" });
}

function outcomeHint(outcome, fileName) {
  switch (outcome) {
    case "shared":
      return hint("Gesichert: " + fileName, "ok");
    case "downloaded":
      return hint("Die Datei " + fileName + " wurde heruntergeladen. Prüf, ob sie angekommen ist, und leg sie an einem sicheren Ort ab.", "ok");
    case "aborted":
      return hint("Abgebrochen, nichts gesichert.", "info");
    default:
      return hint("Das hat nicht geklappt, es wurde nichts gesichert. Versuch es noch einmal.", "error");
  }
}

// Der Knopf bleibt gesperrt, bis die Übergabe fertig ist: Ein zweites share bei offenem Dialog scheitert.
function deliveryButton(label, action, options) {
  const node = button(label, async () => {
    node.disabled = true;
    try {
      await action();
    } finally {
      node.disabled = false;
    }
  }, options);
  return node;
}

function lastBackupText(state) {
  return state.backup.lastAt ? "Letzte Sicherung: " + formatDate(state.backup.lastAt) : "Noch keine Sicherung";
}

async function saveBackup(ctx) {
  const now = ctx.now();
  const at = now.toISOString();
  const backup = createBackup(ctx.state, { appVersion: ctx.version, now });
  backup.state.backup.lastAt = at; // Die Datei nennt sich selbst als letzte Sicherung, auch nach dem Einlesen.
  const file = jsonFile(backup, backupFileName(now));
  const outcome = await deliver(file);
  if (outcome === "shared" || outcome === "downloaded") {
    ctx.state.backup.lastAt = at;
    ctx.save();
  }
  return outcomeHint(outcome, file.name);
}

function summaryFacts(info) {
  const facts = [
    ["Gesichert am", info.createdAt ? formatDate(info.createdAt) : "unbekannt"],
    ["App-Version", info.appVersion ?? "unbekannt"],
    ["Geübte Sätze und Wörter", String(info.units)],
    ["Einstufungstests", String(info.attempts)],
  ];
  return el("dl", { class: "facts" }, facts.map(([name, value]) => [el("dt", null, name), el("dd", null, value)]));
}

function showResult(area, ...nodes) {
  clear(area);
  area.append(...nodes);
  area.scrollIntoView({ block: "center" });
}

// Erst nach der Nachfrage. Der jetzige Stand wird vorher mit keepPrevious aufgehoben.
function replaceLearningState(ctx, state, area, doneText) {
  const previous = ctx.state;
  try {
    ctx.store.keepPrevious();
    ctx.replaceState(state);
    ctx.save();
    ctx.store.clearSession();
    ctx.loadError = null;
  } catch {
    ctx.replaceState(previous);
    showResult(area, hint("Das hat nicht geklappt. Dein jetziger Lernstand bleibt.", "error"));
    return false;
  }
  showResult(area, hint(doneText, "ok"), navButton("Zur Startseite", ctx, "#/", { kind: "primary" }));
  return true;
}

function askBeforeImport(ctx, result, area) {
  confirmDialog(area, {
    title: "Lernstand ersetzen?",
    body: [summaryFacts(result.info), hint(REPLACE_NOTE, "warn")],
    confirmLabel: "Ja, ersetzen",
    onConfirm: () => replaceLearningState(ctx, result.state, area, "Eingelesen."),
  });
}

async function readChosenFile(input, ctx, area) {
  const file = input.files?.[0];
  if (!file) {
    return;
  }
  clear(area);
  let text = null;
  try {
    text = await file.text();
  } catch {
    // parseBackup meldet das unten als nicht lesbar.
  }
  input.value = ""; // Dieselbe Datei lässt sich danach noch einmal wählen.
  const result = parseBackup(text);
  if (result.ok) {
    askBeforeImport(ctx, result, area);
  } else {
    showResult(area, hint(result.reasonDe, "error"));
  }
}

function previousBlock(ctx, previous, area) {
  const day = previous.updatedAt ? formatDate(previous.updatedAt) : "unbekannt";
  const facts = "Stand vom " + day + ", geübte Sätze und Wörter: " + Object.keys(previous.units).length;
  const restore = button("Vorherigen Stand zurückholen", () => {
    confirmDialog(area, {
      title: "Vorherigen Stand zurückholen?",
      body: [el("p", null, facts), hint(REPLACE_NOTE, "warn")],
      confirmLabel: "Ja, zurückholen",
      onConfirm: () => {
        if (replaceLearningState(ctx, previous, area, "Zurückgeholt.")) {
          restore.remove(); // Beim nächsten Öffnen nennt die Karte den Stand, der jetzt aufgehoben ist.
        }
      },
    });
  });
  return [el("p", { class: "muted" }, facts), restore];
}

function brokenBlock(ctx, broken, area) {
  return [
    el("p", { class: "muted" }, "Daten, die diese Version der App nicht lesen kann. Sie bleiben im Speicher, mit der Datei lassen sie sich retten."),
    deliveryButton("Als Datei sichern", async () => {
      const now = ctx.now();
      const file = jsonFile(createRawExport(broken, { appVersion: ctx.version, now }), rawExportFileName(now));
      showResult(area, outcomeHint(await deliver(file), file.name));
    }),
  ];
}

// Nur, wenn es etwas Aufgehobenes gibt. Lässt sich der Speicher nicht lesen, fehlt die Karte.
function recoveryCard(ctx) {
  let previous = null;
  let broken = [];
  try {
    previous = ctx.store.loadPrevious();
    broken = ctx.store.loadBroken();
  } catch {
    return null;
  }
  if (!previous && broken.length === 0) {
    return null;
  }
  const area = el("div", { class: "stack" });
  return card(
    el("p", { class: "card-title" }, "Aufgehobene Stände"),
    previous ? previousBlock(ctx, previous, area) : null,
    broken.length > 0 ? brokenBlock(ctx, broken, area) : null,
    area,
  );
}

function importCard(ctx) {
  const area = el("div", { class: "stack" });
  const input = el("input", {
    type: "file",
    accept: ".json,application/json",
    class: "visually-hidden",
    onchange: () => readChosenFile(input, ctx, area),
  });
  return card(
    el("p", { class: "card-title" }, "Einlesen"),
    el("p", null, "Holt einen gesicherten Lernstand zurück."),
    el("label", { class: "btn btn-secondary" }, "Sicherung auswählen", input),
    area,
  );
}

export async function render(container, ctx) {
  const header = viewHeader(ctx, { title: "Sichern" });
  // Ein Stand aus einer neueren Version bleibt unverändert: nichts sichern und nichts einlesen, bis die App aktualisiert ist.
  if (ctx.loadError?.code === "tooNew") {
    container.append(header, hint(ctx.loadError.message, "warn"), recoveryCard(ctx) ?? "", bottomBar(backButton(ctx)));
    return;
  }

  const lastLine = el("p", { class: "muted" }, lastBackupText(ctx.state));
  const saveResult = el("div", { class: "stack" });
  const saveNow = deliveryButton("Sichern", async () => {
    clear(saveResult);
    saveResult.append(await saveBackup(ctx));
    lastLine.textContent = lastBackupText(ctx.state);
  }, { kind: "primary" });

  container.append(
    header,
    card(
      el("p", null, "Dein Lernstand liegt nur auf diesem iPhone. „Sichern“ legt eine Datei an, die du selbst aufbewahrst."),
      lastLine,
      saveResult,
    ),
    importCard(ctx),
    recoveryCard(ctx) ?? "",
    bottomBar(barRow(backButton(ctx), saveNow)),
  );
}
