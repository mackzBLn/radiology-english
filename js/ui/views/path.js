/*
 * Lernpfad: zwei Stränge, je Abschnitt gelernt von gesamt.
 * Satzbau zeigt die Abschnitte aus den Daten. Fachsprache zeigt je Untersuchung die Szenarien aus content.examSections,
 * die gemeinsame und eigene Einheiten bündeln. Ein Szenario hat keine eigene Abschnitts-ID, die Route nennt es <exam>:<key>.
 * Quelle zum Element details:
 *   https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/details
 */

import { EXAMS } from "../../core/content.js";
import { unitState } from "../../core/state.js";
import { backButton, bottomBar, navButton, progressBar, viewHeader, waitNote } from "../components.js";
import { el } from "../dom.js";
import { routeHash } from "../router.js";

export const EXAM_LABELS = { mri: "MRT", ct: "CT", xray: "Röntgen" };

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

// Regel wie isLearned aus dem Bauauftrag (core/srs.js kommt im nächsten Lauf): Satz nur mit spokenB, sonst ab Box 2.
export function isLearned(contentUnit, unit) {
  return contentUnit.type === "sentence" ? unit.spokenB === true : unit.box >= 2;
}

export function learnedCount(unitIds, content, state) {
  return unitIds.filter((id) => {
    const contentUnit = content.unit(id);
    return contentUnit !== null && isLearned(contentUnit, unitState(state, id));
  }).length;
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

// Der erste Eintrag mit offenen Einheiten, in der Reihenfolge des Lernpfads, mit seiner Gruppe. Ist alles gelernt: null.
export function nextEntry(strands, content, state) {
  for (const group of strands.flatMap((strand) => strand.groups)) {
    const found = group.entries.find((entry) => learnedCount(entry.unitIds, content, state) < entry.unitIds.length);
    if (found) {
      return { ...found, groupId: group.id };
    }
  }
  return null;
}

function entryButton(entry, content, ctx, isNext) {
  const learned = learnedCount(entry.unitIds, content, ctx.state);
  return navButton(
    [
      isNext ? el("span", { class: "next-marker" }, "Hier weitermachen") : null,
      el("span", null, entry.titleDe),
      el("span", { class: "progress-text" }, learned + " von " + entry.unitIds.length + " gelernt"),
      progressBar(learned, entry.unitIds.length),
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
  for (const strand of strands) {
    container.append(
      el("h2", null, strand.titleDe),
      ...strand.groups.map((group) => groupBlock(group, content, ctx, next?.id)),
    );
  }
  container.append(bottomBar(backButton(ctx)));
}
