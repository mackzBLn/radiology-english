/*
 * Lernpfad: zwei Stränge, je Abschnitt gelernt von gesamt.
 * Satzbau zeigt die Abschnitte aus den Daten. Fachsprache zeigt je Untersuchung die Szenarien aus content.examSections,
 * die gemeinsame und eigene Einheiten bündeln. Ein Szenario hat keine eigene Abschnitts-ID, die Route nennt es <exam>:<key>.
 * Quellen:
 *   https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/details
 *   https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort
 */

import { EXAMS } from "../../core/content.js";
import { isLearned } from "../../core/srs.js";
import { unitState } from "../../core/state.js";
import { backButton, bottomBar, navButton, progressBar, viewHeader, waitNote } from "../components.js";
import { el } from "../dom.js";
import { routeHash } from "../router.js";

export const EXAM_LABELS = { mri: "MRT", ct: "CT", xray: "Röntgen" };

// Wer in der Bahn übt, sieht „gelernt“ erst nach dem Sprechen steigen. Darum steht überall, wo die Zahl steht, auch das hier.
export const LEARNED_NOTE = "Ein Satz zählt als gelernt, sobald du ihn frei gesprochen hast. Eine Patientenäußerung oder ein Wort zählt, sobald du es zweimal verstanden hast.";

const SMALL_TALK_PREFIX = "Small Talk: ";

// Bleibt offen, wenn die Nutzerin aus einem Abschnitt zurückkommt. Nur für diese Sitzung, nichts wird gespeichert.
const openGroups = new Set();
// Die Gruppe mit dem nächsten Abschnitt öffnet sich einmal von selbst. Schließt die Nutzerin sie, bleibt sie zu.
let autoOpenedGroup = null;

export function scenarioId(exam, key) {
  return exam + ":" + key;
}

export function parseScenarioId(id) {
  const [exam, key] = String(id).split(":");
  return key && EXAMS.includes(exam) ? { exam, key } : null;
}

// Die Regel steht in core/srs.js, hier nur weitergereicht.
export { isLearned };

export function learnedCount(unitIds, content, state) {
  return unitIds.filter((id) => {
    const contentUnit = content.unit(id);
    return contentUnit !== null && isLearned(contentUnit, unitState(state, id));
  }).length;
}

// Schon geübt, ob gelernt oder nicht. Gelerntes zählt mit, die Zahl ist also nie kleiner als die der gelernten.
export function practicedCount(unitIds, content, state) {
  return unitIds.filter((id) => {
    const contentUnit = content.unit(id);
    const progress = unitState(state, id);
    return contentUnit !== null && ((progress.seen ?? 0) > 0 || isLearned(contentUnit, progress));
  }).length;
}

// „3 von 6 gelernt, 5 geübt“. Die zweite Zahl steht nur da, wenn sie etwas sagt.
export function learnedText(learned, total, practiced) {
  return learned + " von " + total + " gelernt" + (practiced > learned ? ", " + practiced + " geübt" : "");
}

export function buildStrands(content) {
  const sections = content.sections();
  const entry = (section, titleDe = section.titleDe) => ({ id: section.id, titleDe, unitIds: section.unitIds });
  const grammarFile = sections.filter((section) => section.strand === "grammar");
  const isSmallTalk = (section) => section.titleDe.startsWith(SMALL_TALK_PREFIX);
  return [
    {
      titleDe: "Satzbau",
      groups: [
        {
          id: "grammar",
          titleDe: "Grammatik",
          entries: grammarFile.filter((section) => !isSmallTalk(section)).map((section) => entry(section)),
        },
        {
          id: "smalltalk",
          titleDe: "Small Talk",
          entries: grammarFile
            .filter(isSmallTalk)
            .map((section) => entry(section, section.titleDe.slice(SMALL_TALK_PREFIX.length))),
        },
        {
          id: "clarify",
          titleDe: "Klären",
          entries: sections.filter((section) => section.strand === "clarify").map((section) => entry(section)),
        },
      ],
    },
    {
      titleDe: "Fachsprache",
      groups: EXAMS.map((exam) => ({
        id: exam,
        titleDe: EXAM_LABELS[exam],
        entries: content.examSections(exam).map((scenario) => ({
          id: scenarioId(exam, scenario.key),
          titleDe: scenario.titleDe,
          unitIds: scenario.unitIds,
        })),
      })),
    },
  ];
}

/*
 * Sortiert nach dem Lernplan. Rang eines Eintrags ist der kleinste Rang seiner Einheiten nach der Abschnitts-ID.
 * Was der Plan nicht nennt, kommt ans Ende. Bei gleichem Rang bleibt die Reihenfolge, denn sort ist stabil.
 */
function sortByPlan(entries, content, state) {
  const order = state.placement?.plan?.order;
  if (!Array.isArray(order)) {
    return entries;
  }
  const entryRank = (entry) =>
    Math.min(
      order.length,
      ...entry.unitIds
        .map((id) => order.indexOf(content.unit(id)?.sectionId))
        .filter((rank) => rank >= 0),
    );
  return entries
    .map((entry) => ({ entry, rank: entryRank(entry) }))
    .sort((a, b) => a.rank - b.rank)
    .map((item) => item.entry);
}

// Der erste Eintrag mit offenen Einheiten, mit seiner Gruppe. Reihenfolge wie im Lernpfad, liegt ein Plan vor, nach dem Plan. Ist alles gelernt: null.
export function nextEntry(strands, content, state) {
  const entries = strands
    .flatMap((strand) => strand.groups)
    .flatMap((group) => group.entries.map((entry) => ({ ...entry, groupId: group.id })));
  const open = (entry) => learnedCount(entry.unitIds, content, state) < entry.unitIds.length;
  return sortByPlan(entries, content, state).find(open) ?? null;
}

// Wohin „Weiterlernen“ führt: in den nächsten offenen Abschnitt. Ist alles gelernt, in den Lernpfad.
export function nextHash(content, state) {
  const next = nextEntry(buildStrands(content), content, state);
  return next ? routeHash("abschnitt", next.id) : routeHash("pfad");
}

function entryButton(entry, content, ctx, isNext) {
  const learned = learnedCount(entry.unitIds, content, ctx.state);
  const practiced = practicedCount(entry.unitIds, content, ctx.state);
  return navButton(
    [
      isNext ? el("span", { class: "next-marker" }, "Hier weitermachen") : null,
      el("span", null, entry.titleDe),
      el("span", { class: "progress-text" }, learnedText(learned, entry.unitIds.length, practiced)),
      progressBar(learned, entry.unitIds.length, practiced),
    ],
    ctx,
    routeHash("abschnitt", entry.id),
    { class: isNext ? "list-button is-next" : "list-button" },
  );
}

function groupBlock(group, content, ctx, nextId) {
  const unitIds = group.entries.flatMap((entry) => entry.unitIds);
  const learned = learnedCount(unitIds, content, ctx.state);
  const node = el(
    "details",
    { class: "group", open: openGroups.has(group.id) },
    el(
      "summary",
      null,
      el("span", null, group.titleDe),
      el("span", { class: "progress-text" }, learned + " von " + unitIds.length),
    ),
    el("div", { class: "stack" }, group.entries.map((entry) => entryButton(entry, content, ctx, entry.id === nextId))),
  );
  node.addEventListener("toggle", () => {
    if (node.open) {
      openGroups.add(group.id);
    } else {
      openGroups.delete(group.id);
    }
  });
  return node;
}

export async function render(container, ctx) {
  const wait = waitNote();
  container.append(viewHeader(ctx, { title: "Lernpfad" }), wait);
  const content = await ctx.getContent();
  wait.remove();
  const strands = buildStrands(content);
  const next = nextEntry(strands, content, ctx.state);
  if (next && next.groupId !== autoOpenedGroup) {
    openGroups.add(next.groupId);
    autoOpenedGroup = next.groupId;
  }
  container.append(el("p", { class: "muted" }, LEARNED_NOTE));
  for (const strand of strands) {
    container.append(
      el("h2", null, strand.titleDe),
      ...strand.groups.map((group) => groupBlock(group, content, ctx, next?.id)),
    );
  }
  container.append(bottomBar(backButton(ctx)));
}
