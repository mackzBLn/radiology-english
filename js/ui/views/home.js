/*
 * Startseite. Lädt beim Zeichnen keine Inhaltsdaten, alles hier kommt aus dem Lernstand. Nur „Weiterlernen“ braucht sie, erst nach dem Tipp.
 * Quelle:
 *   https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event
 */

import { daysBetween, toDateString } from "../../core/dates.js";
import { barRow, bottomBar, button, card, navButton } from "../components.js";
import { el } from "../dom.js";
import { routeHash } from "../router.js";

const BACKUP_REMINDER_DAYS = 7;

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
  const action = button("Jetzt aktualisieren", () => {
    action.disabled = true;
    action.textContent = "Einen Moment …";
    ctx.worker.applyUpdate();
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

// Führt in den nächsten Abschnitt des Lernpfads. Sind alle gelernt, in den Lernpfad.
function continueButton(ctx) {
  const label = "Weiterlernen";
  const action = button(label, async () => {
    action.disabled = true;
    action.textContent = "Einen Moment …";
    try {
      const [{ buildStrands, nextEntry }, content] = await Promise.all([import("./path.js"), ctx.getContent()]);
      const next = nextEntry(buildStrands(content), content, ctx.state);
      ctx.navigate(next ? routeHash("abschnitt", next.id) : "#/pfad");
    } finally {
      action.disabled = false;
      action.textContent = label;
    }
  }, { kind: "primary" });
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
  return card(el("p", { class: "card-title" }, "Heute fällig: " + count), el("p", { class: "muted" }, count === 1 ? "Eine Übung wartet auf dich." : count + " Übungen warten auf dich."));
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
  container.append(
    card(
      el("p", { class: "card-title" }, "Wo stehst du gerade?"),
      el("p", null, "Ein kurzer Test zeigt es dir und ordnet deinen Lernplan. Er dauert etwa 10 Minuten."),
    ),
    el("p", { class: "version" }, "Version " + ctx.version),
    bottomBar(
      navButton("Einstufungstest starten", ctx, "#/einstufung", { kind: "primary" }),
      button("Ohne Test beginnen", () => {
        ctx.state.placement.skippedAt = ctx.now().toISOString();
        ctx.save();
        ctx.navigate("#/");
      }),
    ),
  );
}

function renderToday(container, ctx) {
  const state = ctx.state;
  const today = ctx.today();
  const tile = (label, hash) => navButton(label, ctx, hash, { class: "tile" });
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
    navButton("Einstufungstest", ctx, "#/einstufung", { kind: "ghost" }),
    navButton("Einstellungen", ctx, "#/einstellungen", { kind: "ghost" }),
    el("p", { class: "version" }, "Version " + ctx.version),
    bottomBar(
      barRow(
        navButton("Bahn", ctx, "#/bahn", { kind: "primary" }),
        navButton("Sprechen", ctx, "#/sprechen", { kind: "primary" }),
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

  // Der Hinweis erscheint nur hier, also nie mitten in einer Übung (Vorgabe).
  const title = container.firstChild;
  const showUpdate = () => {
    if (ctx.worker.isUpdateReady() && !container.querySelector(".card-ok")) {
      title.after(updateCard(ctx));
    }
  };
  showUpdate();
  const stopWatching = ctx.worker.onUpdateReady(showUpdate);

  // Kommt die App nur aus dem Hintergrund zurück, ruft sie keine Seite neu auf. Darum fragt die Startseite selbst nach.
  const checkWhenVisible = () => {
    if (document.visibilityState === "visible") {
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
