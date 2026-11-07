/*
 * Startseite. Lädt beim Zeichnen keine Inhaltsdaten, alles hier kommt aus dem Lernstand und der Sitzung.
 * Nur „Neue Sätze lesen“ braucht sie, erst nach dem Tipp. Darum nennt der Knopf keinen Abschnitt.
 * Quelle:
 *   https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event
 */

import { daysBetween, toDateString } from "../../core/dates.js";
import { barRow, bottomBar, button, card, confirmDialog, navButton } from "../components.js";
import { el } from "../dom.js";
import { routeHash } from "../router.js";

const BACKUP_REMINDER_DAYS = 7;
const PLACEMENT_KIND = "placement";
const PLACEMENT_HASH = "#/einstufung";
// Für den Partner auf dem eigenen Telefon: die Liste nur mit den Patientenkarten. Der Lernstand bleibt unberührt.
const PATIENT_ONLY_HASH = routeHash("partner", "alle", "patient");

// Erster Start: noch nichts geübt, kein Test gemacht und nicht „Ohne Test beginnen“ gewählt.
export function isFirstStart(state) {
  return (
    state.placement.attempts.length === 0 &&
    !state.placement.skippedAt &&
    Object.keys(state.units).length === 0
  );
}

export function dueCount(state, today) {
  return Object.values(state.units).filter((unit) => unit.due && unit.due <= today).length;
}

// „1 Satz oder Wort wartet“, „24 Sätze und Wörter warten“. Überall derselbe Name für dieselbe Sache.
export function waitingText(count) {
  return count === 1 ? "1 Satz oder Wort wartet auf dich." : count + " Sätze und Wörter warten auf dich.";
}

// Ein offener Einstufungstest aus der Sitzung, ohne die Ansicht dafür zu laden. Eine Sitzung einer anderen Version verwirft die App beim Start.
export function openPlacement(store, version) {
  try {
    const session = store.loadSession();
    return session?.kind === PLACEMENT_KIND && session.appVersion === version ? session : null;
  } catch {
    return null; // Die Startseite zeigt den Fehler des Speichers schon, hier fehlt dann nur die Karte.
  }
}

// Hinweis, wenn die letzte Sicherung 7 Tage oder länger her ist und seither geübt wurde.
// Ohne Sicherung zählt der Tag, an dem der Lernstand angelegt wurde.
export function backupReminderDue(state, today) {
  const reference = state.backup.lastAt ?? state.createdAt;
  const date = new Date(reference);
  if (!reference || Number.isNaN(date.getTime())) {
    return false;
  }
  const referenceDay = toDateString(date);
  if (daysBetween(referenceDay, today) < BACKUP_REMINDER_DAYS) {
    return false;
  }
  const referenceTime = date.toISOString();
  const unitPracticed = Object.values(state.units).some(
    (unit) => typeof unit.lastAt === "string" && unit.lastAt > referenceTime,
  );
  const dayPracticed = Object.entries(state.stats.days).some(
    ([day, info]) => day > referenceDay && (info?.exercises ?? 0) > 0,
  );
  return unitPracticed || dayPracticed;
}

function updateCard(ctx) {
  const apply = () => {
    action.disabled = true;
    action.textContent = "Einen Moment …";
    ctx.worker.applyUpdate();
  };
  const action = button("Jetzt aktualisieren", () => {
    // Eine Sitzung passt nur zu ihrer Version (Vorgabe). Ein offener Test beginnt danach von vorn, das sagt die App vorher.
    if (openPlacement(ctx.store, ctx.version)) {
      confirmDialog(action, {
        title: "Jetzt aktualisieren?",
        body: el("p", null, "Dein Einstufungstest ist noch offen. Nach dem Update beginnt er von vorn. An dem, was du schon geübt hast, ändert das nichts."),
        confirmLabel: "Trotzdem aktualisieren",
        onConfirm: apply,
      });
    } else {
      apply();
    }
  }, { kind: "primary" });
  return card({ class: "card-ok" }, el("p", { class: "card-title" }, "Neue Version bereit"), action);
}

function reminderCard(ctx) {
  return card(
    { class: "card-warn" },
    el("p", null, "Zeit zum Sichern: Dein Lernstand liegt nur auf diesem iPhone."),
    navButton("Jetzt sichern", ctx, "#/sichern"),
  );
}

// Führt in den nächsten Abschnitt des Lernpfads, das ist eine Leseseite. Sind alle gelernt, in den Lernpfad.
// Üben ist die Hauptsache, die Knöpfe dafür stehen unten. Darum ist das hier der zweite Rang.
function continueButton(ctx) {
  const label = "Neue Sätze lesen";
  const action = button(label, async () => {
    action.disabled = true;
    action.textContent = "Einen Moment …";
    try {
      const [{ nextHash }, content] = await Promise.all([import("./path.js"), ctx.getContent()]);
      ctx.navigate(nextHash(content, ctx.state));
    } finally {
      action.disabled = false;
      action.textContent = label;
    }
  });
  return action;
}

function dueCard(ctx) {
  const count = dueCount(ctx.state, ctx.today());
  if (count === 0) {
    return card(
      el("p", { class: "card-title" }, "Heute ist nichts fällig"),
      el("p", { class: "muted" }, "Du kannst Neues lernen."),
      continueButton(ctx),
    );
  }
  return card(el("p", { class: "card-title" }, "Heute fällig: " + count), el("p", { class: "muted" }, waitingText(count)));
}

// Weiter ohne zweite Nachfrage: Die Ansicht liest resumeOnLoad, setzt es zurück und macht gleich weiter.
function resumeButton(ctx, session) {
  return button("Weitermachen", () => {
    ctx.store.saveSession({ ...session, resumeOnLoad: true });
    ctx.navigate(PLACEMENT_HASH);
  }, { kind: "primary" });
}

function openTestTexts(session) {
  return [
    el("p", { class: "card-title" }, session.retake ? "Dein Sprechteil ist noch offen" : "Dein Test ist noch offen"),
    el("p", null, "Deine Antworten sind gesichert."),
  ];
}

// Ein Stand aus einer neueren Version: Die App speichert nichts, also gibt es nichts zu üben, bis sie aktualisiert ist.
function renderLocked(container, ctx) {
  container.append(
    navButton("Sichern", ctx, "#/sichern"),
    el("p", { class: "version" }, "Version " + ctx.version),
    bottomBar(button("App neu laden", () => window.location.reload(), { kind: "primary" })),
  );
}

function renderFirstStart(container, ctx) {
  const open = openPlacement(ctx.store, ctx.version);
  container.append(
    open
      ? card({ class: "card-warn" }, openTestTexts(open))
      : card(
          el("p", { class: "card-title" }, "Wo stehst du gerade?"),
          el("p", null, "Ein kurzer Test zeigt es dir und ordnet deinen Lernplan. Er dauert etwa 10 Minuten."),
        ),
    el("p", { class: "version" }, "Version " + ctx.version),
    bottomBar(
      open ? resumeButton(ctx, open) : navButton("Einstufungstest starten", ctx, PLACEMENT_HASH, { kind: "primary" }),
      button("Ohne Test beginnen", () => {
        ctx.state.placement.skippedAt = ctx.now().toISOString();
        ctx.save();
        ctx.navigate("#/");
      }),
      navButton("Ich spiele nur den Patienten", ctx, PATIENT_ONLY_HASH, { kind: "ghost" }),
    ),
  );
}

function renderToday(container, ctx) {
  const state = ctx.state;
  const today = ctx.today();
  const tile = (label, hash) => navButton(label, ctx, hash, { class: "tile" });
  const open = openPlacement(ctx.store, ctx.version);
  if (open) {
    // „Neu beginnen“ führt zur Rückfrage der Ansicht, ein falscher Tipp löscht also nichts.
    container.append(card({ class: "card-warn" }, openTestTexts(open), resumeButton(ctx, open), navButton("Neu beginnen", ctx, PLACEMENT_HASH, { kind: "ghost" })));
  }
  if (backupReminderDue(state, today)) {
    container.append(reminderCard(ctx));
  }
  container.append(
    dueCard(ctx),
    el(
      "div",
      { class: "tile-grid" },
      tile("Partner", "#/partner"),
      tile("Lernpfad", "#/pfad"),
      tile("Fortschritt", "#/fortschritt"),
      tile("Sichern", "#/sichern"),
    ),
    navButton("Einstufungstest", ctx, PLACEMENT_HASH, { kind: "ghost" }),
    navButton("Einstellungen", ctx, "#/einstellungen", { kind: "ghost" }),
    el("p", { class: "version" }, "Version " + ctx.version),
    bottomBar(
      barRow(
        navButton("In der Bahn üben", ctx, "#/bahn", { kind: "primary" }),
        navButton("Sprechen üben", ctx, "#/sprechen", { kind: "primary" }),
      ),
    ),
  );
}

export async function render(container, ctx) {
  container.append(el("h1", null, "Radiology English"));
  if (ctx.loadError) {
    container.append(
      card(
        { class: "card-warn" },
        el("p", null, ctx.loadError.message),
        ctx.loadError.code === "unavailable" ? button("App neu laden", () => window.location.reload()) : null,
      ),
    );
  }
  if (ctx.placementDiscarded) {
    ctx.placementDiscarded = false; // Einmal genügt.
    container.append(card({ class: "card-warn" }, el("p", null, "Dein angefangener Test ließ sich nach dem Update nicht fortsetzen. Er beginnt von vorn, dein Lernstand bleibt.")));
  }

  // Der Hinweis erscheint nur hier, also nie mitten in einer Übung (Vorgabe).
  const title = container.firstChild;
  const showUpdate = () => {
    if (ctx.worker.isUpdateReady() && !container.querySelector(".card-ok")) {
      title.after(updateCard(ctx));
    }
  };
  showUpdate();
  const stopWatching = ctx.worker.onUpdateReady(showUpdate);

  // Kommt die App nur aus dem Hintergrund zurück, ruft sie keine Seite neu auf. Darum fragt die Startseite selbst nach:
  // Liegt ein neuer Tag dazwischen, stimmen „Heute fällig“ und die Erinnerung nicht mehr, die Seite zeichnet sich neu.
  const renderedDay = ctx.today();
  const checkWhenVisible = () => {
    if (document.visibilityState !== "visible") {
      return;
    }
    if (ctx.today() !== renderedDay) {
      ctx.navigate("#/");
    } else {
      ctx.worker.checkForUpdate();
    }
  };
  checkWhenVisible();
  document.addEventListener("visibilitychange", checkWhenVisible);

  if (ctx.loadError?.code === "tooNew") {
    renderLocked(container, ctx);
  } else if (isFirstStart(ctx.state)) {
    renderFirstStart(container, ctx);
  } else {
    renderToday(container, ctx);
  }
  return () => {
    stopWatching();
    document.removeEventListener("visibilitychange", checkWhenVisible);
  };
}
