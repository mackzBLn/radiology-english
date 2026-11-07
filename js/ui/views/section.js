/*
 * Abschnitt: Erklärung, Sätze mit Bedeutung, Anhören, Info-Knopf und Klinik-Hinweis. Üben mit Fokus.
 * Die Route nennt einen Abschnitt aus den Daten (sb.questions) oder ein Szenario einer Untersuchung (mri:safety, siehe path.js).
 * Quellen:
 *   https://developer.mozilla.org/en-US/docs/Web/API/IntersectionObserver
 *   https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/details
 */

import {
  audioButton,
  backButton,
  barRow,
  bottomBar,
  card,
  clinicMark,
  englishText,
  hint,
  infoButton,
  navButton,
  progressBar,
  soundHint,
  viewHeader,
  waitNote,
} from "../components.js";
import { el } from "../dom.js";
import { routeHash } from "../router.js";
import { EXAM_LABELS, LEARNED_NOTE, learnedCount, learnedText, parseScenarioId, practicedCount, scenarioId } from "./path.js";

const SHARED_FILE = "gemeinsam";
const COLLAPSE_FROM = 15; // ab so vielen Karten lässt sich eine Gruppe zuklappen

// focus ist das, was planTrain und planSpeech üben: ein Abschnitt (sb.questions) oder ein Szenario als Ganzes (mri:safety).
export function resolveSection(content, id) {
  const sections = content.sections();
  const scenario = parseScenarioId(id);
  if (!scenario) {
    const section = sections.find((item) => item.id === id);
    return section
      ? {
          titleDe: section.titleDe,
          explanationDe: section.explanationDe,
          explanationSource: section.explanationSource,
          unitIds: section.unitIds,
          focus: section.id,
        }
      : null;
  }
  const entry = content.examSections(scenario.exam).find((item) => item.key === scenario.key);
  if (!entry) {
    return null;
  }
  const own = sections.find((item) => item.exam === scenario.exam && item.key === scenario.key);
  const shared = sections.find((item) => item.file === SHARED_FILE && item.key === scenario.key);
  const explained = [own, shared].find((item) => item?.explanationDe);
  return {
    titleDe: EXAM_LABELS[scenario.exam] + ": " + entry.titleDe,
    explanationDe: explained?.explanationDe ?? null,
    explanationSource: explained?.explanationSource ?? null,
    unitIds: entry.unitIds,
    focus: scenarioId(scenario.exam, scenario.key),
  };
}

export function fittingReactions(unit) {
  return unit.reactions.filter((reaction) => reaction.fits);
}

// Trägt der Abschnitt irgendwo den Klinik-Hinweis, an einer Einheit oder an der passenden Reaktion?
export function hasClinicNote(units) {
  return units.some((unit) => unit.clinicDependent || fittingReactions(unit).some((reaction) => reaction.clinicDependent));
}

function sentenceRow(text, source, clinicDependent, noteDe, content, ctx) {
  return el(
    "div",
    { class: "row" },
    audioButton(text, ctx),
    clinicDependent ? clinicMark(noteDe) : null,
    infoButton(content.source(source)),
  );
}

// Was die Nutzerin auf eine Patientenäußerung antwortet.
function reactionBlock(reaction, noteDe, content, ctx) {
  return el(
    "div",
    { class: "sentence reaction" },
    el("p", { class: "label" }, "Das antwortest du"),
    englishText(reaction.en),
    reaction.meaningDe ? el("p", { class: "meaning-de" }, reaction.meaningDe) : null,
    sentenceRow(reaction.en, reaction.source, reaction.clinicDependent, noteDe, content, ctx),
  );
}

function unitCard(unit, content, ctx) {
  return card(
    englishText(unit.en),
    unit.meaningDe ? el("p", { class: "meaning-de" }, unit.meaningDe) : null,
    unit.noteDe ? el("p", { class: "muted" }, unit.noteDe) : null,
    sentenceRow(unit.en, unit.source, unit.clinicDependent, unit.noteDe, content, ctx),
    unit.type === "patient" ? fittingReactions(unit).map((reaction) => reactionBlock(reaction, unit.noteDe, content, ctx)) : null,
  );
}

function explanationCard(section, content) {
  return card(
    el("p", null, section.explanationDe),
    el("div", { class: "row" }, el("span", { class: "muted" }, "Quelle der Erklärung"), infoButton(content.source(section.explanationSource))),
  );
}

// Lange Gruppen lassen sich zuklappen. Die erste steht offen, die zweite ist dann gleich zu erreichen.
function unitGroup(titleDe, units, open, content, ctx) {
  const heading = titleDe + " (" + units.length + ")";
  const cards = units.map((unit) => unitCard(unit, content, ctx));
  if (units.length < COLLAPSE_FROM) {
    return [el("h3", null, heading), ...cards];
  }
  return el(
    "details",
    { class: "group", open },
    el("summary", null, el("span", null, heading)),
    el("div", { class: "stack" }, cards),
  );
}

// Eigene Sätze und Patientenäußerungen getrennt. Gibt es nur eine Art, braucht sie keine Überschrift.
function unitList(units, content, ctx) {
  const own = units.filter((unit) => unit.type !== "patient");
  const patient = units.filter((unit) => unit.type === "patient");
  if (own.length === 0 || patient.length === 0) {
    return units.map((unit) => unitCard(unit, content, ctx));
  }
  return [unitGroup("Das sagst du", own, true, content, ctx), unitGroup("Das sagt der Patient", patient, false, content, ctx)];
}

export async function render(container, ctx, params) {
  const wait = waitNote();
  const firstHeader = viewHeader(ctx);
  container.append(firstHeader, wait);
  const content = await ctx.getContent();
  wait.remove();

  const section = resolveSection(content, params.id);
  if (!section) {
    container.append(card(el("p", null, "Diesen Abschnitt gibt es nicht.")));
    return undefined;
  }

  const units = section.unitIds.map((id) => content.unit(id)).filter((unit) => unit !== null);
  const learned = learnedCount(section.unitIds, content, ctx.state);
  const practiced = practicedCount(section.unitIds, content, ctx.state);

  // Die feste Kopfzeile nennt den Titel einzeilig, sobald die volle Überschrift weggescrollt ist.
  const header = viewHeader(ctx, { title: section.titleDe, right: el("span", { class: "timer" }, units.length + " Sätze") });
  header.classList.add("view-header-clip", "title-hidden");
  firstHeader.replaceWith(header);
  const fullTitle = el("h2", null, section.titleDe);
  const observer = new IntersectionObserver((entries) => header.classList.toggle("title-hidden", entries.at(-1).isIntersecting));
  observer.observe(fullTitle);

  container.append(
    fullTitle,
    el(
      "div",
      { class: "stack" },
      el("p", { class: "progress-text" }, learnedText(learned, units.length, practiced)),
      progressBar(learned, units.length, practiced),
      el("p", { class: "muted" }, LEARNED_NOTE),
    ),
    section.explanationDe ? explanationCard(section, content) : "",
    hasClinicNote(units) ? hint("Sätze mit gelber Marke hängen von deiner Klinik ab.", "warn") : "",
    soundHint(),
    ...unitList(units, content, ctx).flat(),
    bottomBar(
      barRow(
        navButton("In der Bahn üben", ctx, routeHash("bahn", section.focus), { kind: "primary" }),
        navButton("Sprechen üben", ctx, routeHash("sprechen", section.focus), { kind: "primary" }),
      ),
      backButton(ctx),
    ),
  );
  return () => observer.disconnect();
}
