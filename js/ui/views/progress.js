/*
 * Fortschritt: heute fällig, die letzten 7 Tage, gelernt je Bereich, schwache Einheiten, Abschlüsse und Einstufung.
 * Liest nur Lernstand und Inhaltsdaten und ändert nichts. Leere Bereiche sagen freundlich, was als Nächstes dran ist.
 * Die Balken sind nur CSS, ihre Breite steht im Attribut style.
 * Quellen:
 *   https://developer.mozilla.org/en-US/docs/Web/CSS/flex
 *   https://developer.mozilla.org/en-US/docs/Web/CSS/grid-template-columns
 */

import { EXAMS } from "../../core/content.js";
import { addDays } from "../../core/dates.js";
import { weakUnitsFromRating } from "../../core/partner.js";
import { compareAttempts, overallBelowA1 } from "../../core/placement.js";
import { isDue, isLearned, isWeak } from "../../core/srs.js";
import { unitState } from "../../core/state.js";
import { backButton, bottomBar, card, formatDate, hint, navButton, progressBar, viewHeader } from "../components.js";
import { el } from "../dom.js";
import { routeHash } from "../router.js";
import { dueCount, waitingText } from "./home.js";
import { finalStatus, loadContentFor, shortRating } from "./partner.js";
import { EXAM_LABELS, LEARNED_NOTE, learnedText, practicedCount } from "./path.js";

const TITLE = "Fortschritt";
const DAYS_SHOWN = 7;
const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const PARTS = [
  { part: "speaking", labelDe: "Sprechen" },
  { part: "listening", labelDe: "Hören" },
  { part: "writing", labelDe: "Schreiben" },
];
const NOTE_LIMIT = 80;

const BETWEEN_STYLE = "justify-content:space-between";
const THREE_COLUMNS_STYLE = "grid-template-columns:minmax(0,1fr) auto auto";

// ---------- Ohne DOM, in Node geprüft ----------

// Die letzten Tage bis heute, der älteste zuerst. Tage ohne Eintrag zählen 0.
export function lastDays(state, today, count = DAYS_SHOWN) {
  const days = [];
  for (let back = count - 1; back >= 0; back -= 1) {
    const date = addDays(today, -back);
    const info = Object.hasOwn(state.stats.days, date) ? state.stats.days[date] : null;
    days.push({ date, exercises: info?.exercises ?? 0 });
  }
  return days;
}

export function dayLabel(date, today) {
  if (date === today) {
    return "Heute";
  }
  const [, month, day] = date.split("-");
  return WEEKDAYS[new Date(date + "T00:00:00Z").getUTCDay()] + " " + day + "." + month + ".";
}

// Breite eines Balkens in Prozent, der stärkste Tag füllt die ganze Breite.
export function barPercent(value, peak) {
  return peak > 0 ? Math.round((value / peak) * 100) : 0;
}

function learnedOf(unitIds, content, state) {
  const units = [...new Set(unitIds)].filter((id) => content.unit(id) !== null);
  return {
    learned: units.filter((id) => isLearned(content.unit(id), unitState(state, id))).length,
    practiced: practicedCount(units, content, state),
    total: units.length,
  };
}

export function areaProgress(content, state) {
  const ofStrand = (strand) =>
    content
      .sections()
      .filter((section) => section.strand === strand)
      .flatMap((section) => section.unitIds);
  return [
    { labelDe: "Satzbau", ...learnedOf(ofStrand("grammar"), content, state) },
    { labelDe: "Klären", ...learnedOf(ofStrand("clarify"), content, state) },
    ...EXAMS.map((exam) => ({
      labelDe: EXAM_LABELS[exam],
      ...learnedOf(content.examSections(exam).flatMap((section) => section.unitIds), content, state),
    })),
  ];
}

export function weakCount(state) {
  return Object.values(state.units).filter(isWeak).length;
}

// Wie viele der heute fälligen Einheiten aus Partner-Bewertungen kommen. Sie sind oft noch nie geübt, also auch nicht schwach.
export function dueFromRatings(state, content, today) {
  const ids = new Set(state.partner.flatMap((entry) => weakUnitsFromRating(entry, content)));
  return [...ids].filter((id) => isDue(unitState(state, id), today)).length;
}

function levelText(level, belowA1 = false) {
  if (level === null) {
    return "nicht gemessen";
  }
  return belowA1 ? "unter A1" : level;
}

// Erster und letzter Versuch je Teil. Ohne Versuch: null.
export function placementOverview(attempts) {
  if (attempts.length === 0) {
    return null;
  }
  const first = attempts[0];
  const latest = attempts.at(-1);
  const comparison = compareAttempts(first, latest);
  const rows = PARTS.map(({ part, labelDe }) => ({
    labelDe,
    first: levelText(comparison[part].first, comparison[part].firstBelowA1),
    latest: levelText(comparison[part].latest, comparison[part].latestBelowA1),
  }));
  rows.push({
    labelDe: "Gesamt",
    first: levelText(comparison.overall.first, overallBelowA1(first)),
    latest: levelText(comparison.overall.latest, overallBelowA1(latest)),
  });
  return { count: attempts.length, firstAt: first.at, latestAt: latest.at, rows };
}

export function clipNote(text) {
  return text.length > NOTE_LIMIT ? text.slice(0, NOTE_LIMIT - 1) + "…" : text;
}

// ---------- Karten ----------

function dueCard(content, ctx) {
  const due = dueCount(ctx.state, ctx.today());
  if (due === 0) {
    return card(el("p", { class: "card-title" }, "Heute ist nichts fällig"), el("p", { class: "muted" }, "Du kannst Neues lernen. Tippe unten auf „Jetzt üben“."));
  }
  const fromRatings = dueFromRatings(ctx.state, content, ctx.today());
  return card(
    el("p", { class: "card-title" }, "Heute fällig: " + due),
    el("p", { class: "muted" }, waitingText(due)),
    fromRatings > 0 ? el("p", { class: "muted" }, "Davon aus Bewertungen mit dem Partner: " + fromRatings + ". Eine Runde in der Bahn nimmt immer nur einen Teil davon.") : null,
  );
}

function dayRow(day, today, peak) {
  return el(
    "div",
    { class: "row" },
    el("span", { class: "muted", style: "flex:0 0 5.5em" }, dayLabel(day.date, today)),
    el("span", { class: "progress", style: "flex:1 1 auto;height:14px" }, el("span", { class: "progress-fill", style: "width:" + barPercent(day.exercises, peak) + "%" })),
    el("span", { class: "timer", style: "flex:0 0 2.5em;text-align:right" }, String(day.exercises)),
  );
}

function weekCard(ctx) {
  const today = ctx.today();
  const days = lastDays(ctx.state, today);
  const total = days.reduce((sum, day) => sum + day.exercises, 0);
  if (total === 0) {
    return card(
      el("p", { class: "card-title" }, "Die letzten 7 Tage"),
      el("p", null, "Hier ist noch alles frei. Nach deiner ersten Übung steht hier dein erster Balken."),
    );
  }
  const peak = Math.max(...days.map((day) => day.exercises));
  return card(
    el("p", { class: "card-title" }, "Die letzten 7 Tage"),
    el("p", { class: "muted" }, total === 1 ? "1 Übung" : total + " Übungen"),
    days.map((day) => dayRow(day, today, peak)),
  );
}

function areaRow(area) {
  return el(
    "div",
    { class: "sentence" },
    el(
      "div",
      { class: "row", style: BETWEEN_STYLE },
      el("span", null, area.labelDe),
      el("span", { class: "progress-text" }, learnedText(area.learned, area.total, area.practiced)),
    ),
    progressBar(area.learned, area.total, area.practiced),
  );
}

function learnedCard(content, ctx) {
  const areas = areaProgress(content, ctx.state);
  const nothingYet = areas.every((area) => area.learned === 0);
  return card(
    el("p", { class: "card-title" }, "Gelernt"),
    areas.map(areaRow),
    el("p", { class: "muted" }, LEARNED_NOTE),
    nothingYet ? navButton("Sprechen üben", ctx, routeHash("sprechen")) : null,
  );
}

function weakCard(ctx) {
  const weak = weakCount(ctx.state);
  return card(
    el("p", { class: "card-title" }, "Schwache Sätze und Wörter: " + weak),
    el("p", { class: "muted" }, weak === 0 ? "Gerade ist nichts schwach." : "Sie kommen in der Bahn bevorzugt wieder dran."),
  );
}

function finalBlock(exam, ctx) {
  const { passedAt, last } = finalStatus(ctx.state.partner, exam);
  return el(
    "div",
    { class: "sentence" },
    el("p", { class: "situation-de" }, EXAM_LABELS[exam]),
    passedAt ? hint("Bestanden am " + formatDate(passedAt), "ok") : el("p", { class: "muted" }, "Noch offen"),
    last ? el("p", { class: "muted" }, "Letzte Bewertung: " + shortRating(last)) : null,
    last?.helpNote ? el("p", { class: "muted" }, "Wobei: " + clipNote(last.helpNote)) : null,
  );
}

function finalsCard(ctx) {
  return card(
    el("p", { class: "card-title" }, "Abschluss"),
    ctx.state.partner.length === 0 ? el("p", null, "Noch kein Rollenspiel bewertet. Such dir jemanden, der den Patienten spielt.") : null,
    EXAMS.map((exam) => finalBlock(exam, ctx)),
    navButton("Zu den Fällen", ctx, routeHash("partner")),
  );
}

function placementTable(overview) {
  const compare = overview.count > 1;
  const head = compare
    ? [el("dt", null, "Teil"), el("dd", { class: "label" }, "Erster"), el("dd", { class: "label" }, "Letzter")]
    : [el("dt", null, "Teil"), el("dd", { class: "label" }, "Stufe")];
  return el(
    "dl",
    { class: "facts", style: compare ? THREE_COLUMNS_STYLE : null },
    head,
    overview.rows.map((row) => [el("dt", null, row.labelDe), el("dd", null, row.first), compare ? el("dd", null, row.latest) : null]),
  );
}

function placementCard(ctx) {
  const overview = placementOverview(ctx.state.placement.attempts);
  if (!overview) {
    return card(
      el("p", { class: "card-title" }, "Einstufung"),
      el("p", null, "Noch kein Test gemacht. Er zeigt dir in etwa 10 Minuten, wo du stehst."),
      navButton("Einstufungstest starten", ctx, routeHash("einstufung")),
    );
  }
  const compare = overview.count > 1;
  return card(
    el("p", { class: "card-title" }, "Einstufung"),
    placementTable(overview),
    el(
      "p",
      { class: "muted" },
      compare
        ? "Erster Versuch am " + formatDate(overview.firstAt) + ", letzter am " + formatDate(overview.latestAt) + ". Grobe Orientierung, keine Prüfung."
        : "Versuch am " + formatDate(overview.firstAt) + ". Grobe Orientierung, keine Prüfung. Mach den Test später noch einmal, dann siehst du hier den Vergleich.",
    ),
    navButton("Test wiederholen", ctx, routeHash("einstufung")),
  );
}

// ---------- Ansicht ----------

export async function render(container, ctx) {
  const content = await loadContentFor(container, ctx, { title: TITLE, hash: routeHash("fortschritt") });
  if (content === null) {
    return;
  }
  container.append(
    viewHeader(ctx, { title: TITLE }),
    dueCard(content, ctx),
    weekCard(ctx),
    learnedCard(content, ctx),
    weakCard(ctx),
    finalsCard(ctx),
    placementCard(ctx),
    bottomBar(navButton("Jetzt üben", ctx, routeHash("bahn"), { kind: "primary" }), backButton(ctx)),
  );
}
