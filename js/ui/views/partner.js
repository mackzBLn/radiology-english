/*
 * Partner und Abschluss: Fall wählen, Rollenkarte lesen, gemeinsam bewerten.
 * Die Karte für den Patienten liest nur die Inhaltsdaten. Sie braucht keine Anmeldung und keinen Lernstand, auch auf einem anderen Telefon.
 * Die Liste nennt nur Fallnummern, denn ein Titel verrät, was die Person, die übt, selbst erfragen soll.
 * Bewerten und Ergebnis sind Schritte innerhalb der Route. Zurück führt aus dem Ergebnis also zur Liste, nicht ins leere Formular.
 * Quellen:
 *   https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollIntoView
 *   https://developer.mozilla.org/en-US/docs/Web/CSS/scroll-margin-top
 *   https://developer.mozilla.org/en-US/docs/Web/API/Location/href
 *   https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/details
 *   https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-pressed
 */

import { EXAMS } from "../../core/content.js";
import { RATING_UNITS_PER_DAY, applyRating, weakUnitsFromRating } from "../../core/partner.js";
import { audioButton, backButton, barRow, bottomBar, button, card, copyButton, englishText, formatDate, hint, infoButton, navButton, noPatientDataHint, soundHint, viewHeader, waitNote } from "../components.js";
import { clear, el } from "../dom.js";
import { routeHash } from "../router.js";
import { EXAM_LABELS } from "./path.js";

const TITLE = "Partner";
const ROLE_LEARNER = "mtr";
const ROLE_PATIENT = "patient";
// #/partner/alle/patient: die Liste für den Partner auf dem eigenen Telefon, nur mit den Patientenkarten.
const ALL_CASES = "alle";
const FINAL = "final";
const CONFIRM_CHECKS = ["fa.check.1", "fa.check.2", "fa.check.3", "fa.check.4"];
const HELP_CHECK = "fa.check.5";
const HELP_WORDS = { no: "ohne Hilfe", partly: "etwas Hilfe", yes: "mit Hilfe" };
const CHOICES = [{ value: "yes", labelDe: "ja" }, { value: "partly", labelDe: "teilweise" }, { value: "no", labelDe: "nein" }];
const COMES_BACK_LABELS = {
  "fa.check.1": "Begrüßung und Sicherheitsfragen",
  "fa.check.2": "Patienten verstehen",
  "fa.check.3": "Nachfragen und bestätigen",
  "fa.check.4": "Verstehen prüfen",
  "fa.check.5": "Rettungssätze",
};
const HOLD_AFTER_SAVE_MS = 450;

const LIST_STYLE = "margin:0;padding-left:20px";
const TIGHT_BUTTON_STYLE = "padding-left:6px;padding-right:6px";
// Sprungziele enden nicht unter der festen Kopfzeile.
const JUMP_TARGET_STYLE = "scroll-margin-top:calc(56px + env(safe-area-inset-top))";

// ---------- Ohne DOM, in Node geprüft ----------

export function caseNumber(id) {
  return String(id).split(".").at(-1);
}

function kindOf(type) {
  return type === FINAL ? "Abschluss" : "Übung";
}

export function caseLabel(item) {
  return "Fall " + caseNumber(item.id) + ": " + kindOf(item.type);
}

export function caseName(item) {
  return EXAM_LABELS[item.exam] + ", " + caseLabel(item);
}

export function casesOfExam(content, exam) {
  return content.cases.filter((item) => item.exam === exam);
}

// Stand eines Falls aus state.partner. Die Einträge stehen in der Reihenfolge, in der sie gespeichert wurden.
export function statusOfCase(partnerEntries, item) {
  const entries = partnerEntries.filter((entry) => entry.caseId === item.id);
  const last = entries.at(-1);
  if (item.type !== FINAL) {
    return last ? { tone: "done", textDe: "Zuletzt geübt am " + formatDate(last.at) } : { tone: "open", textDe: "Noch nicht geübt" };
  }
  const passed = entries.filter((entry) => entry.passed === true).at(-1);
  if (passed) {
    return { tone: "ok", textDe: "Bestanden am " + formatDate(passed.at) };
  }
  return { tone: "open", textDe: last ? "Noch nicht bestanden, zuletzt am " + formatDate(last.at) : "Noch offen" };
}

// Abschluss einer Untersuchung: Wann zuletzt bestanden, und die letzte Bewertung überhaupt, auch einer Übung.
export function finalStatus(partnerEntries, exam) {
  const entries = partnerEntries.filter((entry) => entry.exam === exam);
  const passed = entries.filter((entry) => entry.type === FINAL && entry.passed === true).at(-1);
  return { passedAt: passed?.at ?? null, last: entries.at(-1) ?? null };
}

export function shortRating(entry) {
  const ratings = entry.ratings ?? {};
  const confirmed = CONFIRM_CHECKS.filter((check) => ratings[check] === "yes").length;
  const when = "Fall " + caseNumber(entry.caseId) + " (" + kindOf(entry.type) + ") am " + formatDate(entry.at);
  return [when, confirmed + " von " + CONFIRM_CHECKS.length + " Punkten", HELP_WORDS[ratings[HELP_CHECK]]].filter(Boolean).join(", ");
}

// Die Adresse, die das zweite Telefon öffnet: dieselbe App, die Liste der Fälle.
export function partnerAddress(href) {
  return String(href).split("#")[0] + routeHash("partner");
}

export function openChecks(checklist, ratings) {
  return checklist.filter((check) => !ratings[check.id]);
}

export function missedChecks(checklist, ratings) {
  return checklist
    .filter((check) => ratings[check.id] !== (check.id === HELP_CHECK ? "no" : "yes"))
    .map((check) => check.labelDe + ": " + (CHOICES.find((choice) => choice.value === ratings[check.id])?.labelDe ?? "nicht bewertet"));
}

export function buildRating(item, ratings, helpNote, now) {
  return { caseId: item.id, exam: item.exam, type: item.type, at: now.toISOString(), ratings: { ...ratings }, helpNote: String(helpNote ?? "").trim() };
}

// Wie viele Einheiten wiederkommen, und aus welchen Bereichen. Die Rechnung selbst steht in core/partner.js.
export function whatComesBack(rating, content) {
  const ratings = rating.ratings ?? {};
  const items = Object.entries(COMES_BACK_LABELS)
    .map(([check, labelDe]) => ({
      labelDe,
      count: ratings[check] === undefined ? 0 : weakUnitsFromRating({ ...rating, ratings: { [check]: ratings[check] } }, content).length,
    }))
    .filter((item) => item.count > 0);
  return { total: weakUnitsFromRating(rating, content).length, items };
}

export function comesBackTitle(total) {
  if (total === 0) {
    return "Es kommt nichts extra wieder dran";
  }
  return total === 1 ? "1 Satz oder Wort kommt wieder dran" : total + " Sätze und Wörter kommen wieder dran";
}

export function isPatientOnly(params) {
  return params?.caseId === ALL_CASES && params.role === ROLE_PATIENT;
}

function tryToSave(ctx) {
  try {
    ctx.save();
    return null;
  } catch (error) {
    return error;
  }
}

// Die Bewertung kommt genau einmal in den Lernstand, auch bei zwei schnellen Tipps. Jeder weitere Aufruf liefert dasselbe Ergebnis.
export function createRatingSaver(ctx, content) {
  let outcome = null;
  return (rating) => {
    if (!outcome) {
      const entry = applyRating(ctx.state, rating, content, ctx.today());
      outcome = { entry, error: tryToSave(ctx) };
    }
    return outcome;
  };
}

// ---------- Inhaltsdaten ----------

// Klappt das Laden nicht, etwa beim ersten Öffnen ohne Netz, gibt es einen neuen Versuch statt der Fehlerkarte. Dann kommt null zurück.
export async function loadContentFor(container, ctx, { title, hash }) {
  container.append(viewHeader(ctx, { title }), waitNote());
  try {
    const content = await ctx.getContent();
    clear(container);
    return content;
  } catch {
    clear(container);
    container.append(
      viewHeader(ctx, { title }),
      card(el("p", { class: "card-title" }, "Das ließ sich gerade nicht laden"), el("p", null, "Prüfe, ob das Telefon Netz hat, und versuche es noch einmal.")),
      bottomBar(button("Nochmal versuchen", () => ctx.navigate(hash), { kind: "primary" }), backButton(ctx)),
    );
    return null;
  }
}

// ---------- Bausteine ----------

function bulletList(items) {
  return el("ul", { style: LIST_STYLE }, items.map((text) => el("li", null, text)));
}

function labelled(labelDe, ...children) {
  return card(el("p", { class: "label" }, labelDe), ...children);
}

// ---------- Liste der Fälle ----------

// Bleibt offen, wenn jemand aus einem Fall zurückkommt. Nur für diese Sitzung, nichts wird gespeichert.
const openExams = new Set();
let openedOnce = false;

function howItWorks(ctx) {
  const address = partnerAddress(globalThis.location.href);
  return el(
    "details",
    { class: "group" },
    el("summary", null, el("span", null, "So geht es")),
    el(
      "div",
      { class: "stack" },
      bulletList([
        "Zwei Telefone: Beide öffnen dieselbe Adresse und denselben Fall.",
        "Eine Person tippt „Ich übe“, die andere „Ich spiele den Patienten“.",
        "Danach bewertet ihr gemeinsam.",
        "Nur ein Telefon geht auch: Die Karte bleibt verdeckt, bis der Partner sie aufdeckt.",
      ]),
      el("p", { class: "label" }, "Adresse für das zweite Telefon"),
      el("p", { class: "pre-text" }, address),
      copyButton(() => address, { label: "Adresse kopieren" }),
      el("p", { class: "muted" }, "Kein Konto, keine Anmeldung. Die Adresse zu öffnen reicht."),
    ),
  );
}

function caseCard(item, ctx, patientOnly) {
  if (patientOnly) {
    return card(el("p", { class: "card-title" }, caseLabel(item)), navButton("Fall öffnen", ctx, routeHash("partner", item.id, ROLE_PATIENT), { kind: "primary" }));
  }
  const status = statusOfCase(ctx.state.partner, item);
  return card(
    el("p", { class: "card-title" }, caseLabel(item)),
    status.tone === "ok" ? hint(status.textDe, "ok") : el("p", { class: "muted" }, status.textDe),
    navButton("Ich übe", ctx, routeHash("partner", item.id, ROLE_LEARNER), { kind: "primary" }),
    navButton("Ich spiele den Patienten", ctx, routeHash("partner", item.id, ROLE_PATIENT)),
  );
}

function examGroup(exam, content, ctx, patientOnly) {
  const finalText = finalStatus(ctx.state.partner, exam).passedAt ? "Abschluss bestanden" : "Abschluss offen";
  const node = el(
    "details",
    { class: "group", open: openExams.has(exam) },
    el("summary", null, el("span", null, EXAM_LABELS[exam]), patientOnly ? null : el("span", { class: "progress-text" }, finalText)),
    el("div", { class: "stack" }, casesOfExam(content, exam).map((item) => caseCard(item, ctx, patientOnly))),
  );
  node.addEventListener("toggle", () => (node.open ? openExams.add(exam) : openExams.delete(exam)));
  return node;
}

// Zuerst die Fälle, darum geht es hier. Die Erklärung steht zugeklappt darunter.
function renderList(container, ctx, content, patientOnly = false) {
  if (!openedOnce) {
    openedOnce = true;
    openExams.add(EXAMS.find((exam) => !finalStatus(ctx.state.partner, exam).passedAt) ?? EXAMS[0]);
  }
  container.append(
    viewHeader(ctx, { title: TITLE }),
    el(
      "p",
      null,
      patientOnly
        ? "Du spielst den Patienten. Wähle denselben Fall wie die Person, die übt."
        : "Jemand spielt den Patienten, du führst durch die Untersuchung. Wähle einen Fall.",
    ),
    ...EXAMS.map((exam) => examGroup(exam, content, ctx, patientOnly)),
    ...(patientOnly ? [] : [howItWorks(ctx)]),
    bottomBar(backButton(ctx)),
  );
}

// ---------- Ein Fall: die Schritte teilen sich flow ----------

function showStep(flow, ...nodes) {
  flow.ctx.tts.cancel();
  clear(flow.container);
  flow.container.append(...nodes.flat().filter(Boolean));
  globalThis.scrollTo(0, 0);
}

function showRole(flow) {
  if (flow.role === ROLE_LEARNER) {
    showLearner(flow);
  } else if (flow.revealed) {
    showPatientCard(flow);
  } else {
    showPatientGate(flow);
  }
}

// ----- Rolle MTR: nur die Aufgabe, nichts sonst vom Fall -----

function finalRules() {
  return card(
    { class: "card-warn" },
    el("p", { class: "card-title" }, "Abschluss: ohne Hilfe"),
    bulletList(["Kein Hinweis-Knopf", "Keine Übersetzung", "Kein Vorspielen", "Kein Deutsch"]),
    hint("Beim Patienten nachfragen ist erlaubt und gewollt.", "ok"),
  );
}

function showLearner(flow) {
  const { ctx, item } = flow;
  showStep(
    flow,
    viewHeader(ctx, { title: caseName(item) }),
    labelled("Deine Aufgabe", el("p", { class: "situation-de" }, item.taskDe)),
    item.type === FINAL ? finalRules() : hint("Das ist eine Übung. Hilfe ist erlaubt."),
    el("p", { class: "muted" }, "Dein Partner öffnet auf seinem Telefon denselben Fall und tippt „Ich spiele den Patienten“."),
    el("p", { class: "muted" }, "Nur ein Telefon? Tippe auf „Zurück“, wähle dort „Ich spiele den Patienten“ und gib das Telefon weiter."),
    bottomBar(button("Gespräch beendet, jetzt bewerten", () => showRating(flow), { kind: "primary" }), backButton(ctx)),
  );
}

// ----- Rolle Patient -----

function showPatientGate(flow) {
  const { ctx, item } = flow;
  const reveal = () => {
    flow.revealed = true;
    showRole(flow);
  };
  showStep(
    flow,
    viewHeader(ctx, { title: caseName(item) }),
    card(
      { class: "card-warn" },
      el("p", { class: "card-title" }, "Nur für den Partner, bitte nicht mitlesen"),
      el("p", null, "Diese Karte ist für die Person, die den Patienten spielt. Sie zeigt alle Antworten und die Wendungen im Gespräch."),
      el("p", { class: "muted" }, "Du übst selbst? Dann tippe auf „Zurück“ und wähle „Ich übe“."),
    ),
    bottomBar(button("Karte aufdecken", reveal, { kind: "primary" }), backButton(ctx)),
  );
}

function howToPlay(item) {
  return labelled(
    "So spielst du",
    bulletList([
      "Du bist der Patient. Die andere Person führt dich auf Englisch durch die Untersuchung.",
      "Antworte auf Englisch und nur auf das, was gefragt wird. Du darfst die Sätze ablesen.",
      "Bau die Wendungen an der genannten Stelle ein. Kennt die andere Person sie schon von einem früheren Versuch, denk dir eine neue aus.",
      item.type === FINAL
        ? "Das ist der Abschluss: Hilf nicht. Kein Deutsch, nichts vorsagen. Wird nachgefragt, wiederhole es langsam."
        : "Das ist eine Übung: Du darfst helfen, wenn es hakt.",
    ]),
  );
}

function sentenceBlock(sentence, content, ctx) {
  return [
    englishText(sentence.en),
    el("p", { class: "meaning-de" }, sentence.meaningDe),
    el("div", { class: "row" }, audioButton(sentence.en, ctx), infoButton(content.source(sentence.source))),
  ];
}

function twistCard(twist, content, ctx) {
  return card(
    { class: "card-warn" },
    el("p", { class: "label" }, "Wann: " + twist.whenDe),
    sentenceBlock(twist, content, ctx),
    el("div", { class: "sentence reaction" }, el("p", { class: "label" }, "Das sollte die andere Person dann tun"), el("p", null, twist.expectedDe)),
  );
}

function answerCard(answer, content, ctx) {
  return card(el("p", { class: "label" }, answer.whenDe), sentenceBlock(answer, content, ctx));
}

function showPatientCard(flow) {
  const { ctx, content, item } = flow;
  const heading = (text) => el("h2", { style: JUMP_TARGET_STYLE }, text);
  const roleTitle = heading(item.titleDe);
  const twistsTitle = heading("Wendungen (" + item.twists.length + ")");
  const answersTitle = heading("Musterantworten (" + item.answers.length + ")");
  const jump = (label, target) => button(label, () => target.scrollIntoView({ block: "start" }), { style: TIGHT_BUTTON_STYLE });
  showStep(
    flow,
    viewHeader(ctx, { title: caseName(item) }),
    roleTitle,
    labelled("Wer du bist", el("p", null, item.patientProfileDe)),
    howToPlay(item),
    labelled("Das muss abgefragt werden", bulletList(item.mustAskDe)),
    twistsTitle,
    el("p", { class: "muted" }, "Das sind kleine Überraschungen. Die andere Person kennt sie nicht."),
    item.twists.map((twist) => twistCard(twist, content, ctx)),
    answersTitle,
    el("p", { class: "muted" }, "Oben steht jeweils, wann die Antwort passt."),
    soundHint(),
    item.answers.map((answer) => answerCard(answer, content, ctx)),
    card(
      el("p", { class: "card-title" }, "Gespräch beendet?"),
      hint("Bewertet wird auf dem Telefon der Person, die übt. Habt ihr nur ein Telefon, bewertet ihr hier."),
      button("Gespräch beendet, jetzt bewerten", () => showRating(flow)),
      backButton(ctx),
    ),
    bottomBar(barRow(jump("Rolle", roleTitle), jump("Wendungen", twistsTitle), jump("Antworten", answersTitle))),
  );
}

// ----- Bewerten -----

function helpNoteFields(draft) {
  const note = el("textarea", { class: "input", id: "partner-help-note", rows: "3", value: draft.helpNote });
  note.addEventListener("input", () => {
    draft.helpNote = note.value;
  });
  return [el("label", { class: "label", for: "partner-help-note" }, "Wobei? Das ist freiwillig."), note, noPatientDataHint()];
}

function checkBlock(check, draft, onChange) {
  const options = CHOICES.map(({ value, labelDe }) => ({
    value,
    node: button(labelDe, () => {
      draft.ratings[check.id] = value;
      mark();
      onChange();
    }, { style: TIGHT_BUTTON_STYLE }),
  }));
  function mark() {
    for (const { value, node } of options) {
      const chosen = draft.ratings[check.id] === value;
      node.classList.toggle("btn-primary", chosen);
      node.classList.toggle("btn-secondary", !chosen);
      node.setAttribute("aria-pressed", String(chosen));
    }
  }
  mark();
  return card(
    el("p", { class: "card-title" }, check.labelDe),
    check.id === HELP_CHECK ? el("p", { class: "muted" }, "Hier ist „nein“ das gute Ergebnis.") : null,
    el("div", { class: "row", role: "group", "aria-label": check.labelDe }, options.map((option) => option.node)),
    check.id === HELP_CHECK ? helpNoteFields(draft) : null,
  );
}

function showRating(flow) {
  const { ctx, content, item, draft } = flow;
  const saveButton = button("", () => {
    saveButton.disabled = true;
    showResult(flow, flow.saveRating(buildRating(item, draft.ratings, draft.helpNote, ctx.now())));
  }, { kind: "primary" });
  function refresh() {
    const open = openChecks(content.checklist, draft.ratings).length;
    saveButton.disabled = open > 0;
    saveButton.textContent = open === 0 ? "Bewertung speichern" : "Noch " + open + (open === 1 ? " Punkt offen" : " Punkte offen");
  }
  refresh();
  showStep(
    flow,
    viewHeader(ctx, { title: item.type === FINAL ? "Abschluss bewerten" : "Übung bewerten", onBack: () => showRole(flow) }),
    el("p", null, "Bewertet die fünf Punkte gemeinsam. Was noch nicht sitzt, kommt gezielt wieder dran."),
    el("div", { class: "stack large-targets" }, content.checklist.map((check) => checkBlock(check, draft, refresh))),
    bottomBar(saveButton),
  );
}

// ----- Ergebnis -----

function saveProblemCard(ctx) {
  const message = el("p", null, "Die Bewertung ließ sich gerade nicht speichern. Lass die App offen und versuche es noch einmal.");
  const retry = button("Nochmal speichern", () => {
    if (tryToSave(ctx) === null) {
      node.replaceWith(hint("Jetzt ist die Bewertung gespeichert.", "ok"));
    } else {
      message.textContent = "Das hat wieder nicht geklappt. Lass die App offen und versuche es gleich noch einmal.";
    }
  }, { kind: "primary" });
  const node = card({ class: "card-error" }, message, retry);
  return node;
}

function verdictCard(entry, content) {
  if (entry.passed) {
    return card({ class: "card-ok" }, el("h2", { class: "card-title" }, "Bestanden"), el("p", null, "Du hast das Gespräch ohne Hilfe geführt. Genau darum geht es."));
  }
  return card(
    { class: "card-warn" },
    el("h2", { class: "card-title" }, "Noch nicht"),
    el("p", null, "Übe, was wiederkommt. Dann versucht ihr es noch einmal. Die Wendungen kennst du jetzt, darum denkt sich dein Partner beim nächsten Mal eine neue aus."),
    el("p", { class: "label" }, "Das saß noch nicht"),
    bulletList(missedChecks(content.checklist, entry.ratings)),
  );
}

export function comesBackWhen(total) {
  if (total === 0) {
    return null;
  }
  return total <= RATING_UNITS_PER_DAY
    ? "Das ist heute in der Bahn fällig."
    : "Heute sind die wichtigsten " + RATING_UNITS_PER_DAY + " in der Bahn fällig, der Rest verteilt sich auf die nächsten Tage.";
}

function comesBackCard(comesBack) {
  const when = comesBackWhen(comesBack.total);
  return card(
    el("h2", { class: "card-title" }, comesBackTitle(comesBack.total)),
    when ? el("p", null, when) : null,
    comesBack.items.length > 0 ? bulletList(comesBack.items.map((part) => part.labelDe + ": " + part.count)) : null,
  );
}

// Ein zweiter Tipp auf „Speichern“ träfe den Knopf, der jetzt an derselben Stelle steht. Darum sind die Knöpfe kurz gesperrt.
function holdBriefly(buttons, held = true) {
  for (const node of buttons) {
    node.disabled = held;
  }
  if (held) {
    setTimeout(() => holdBriefly(buttons, false), HOLD_AFTER_SAVE_MS);
  }
}

function showResult(flow, { entry, error }) {
  const { ctx, content, item } = flow;
  const comesBack = whatComesBack(entry, content);
  const hasWork = comesBack.total > 0;
  const toTrain = navButton("In der Bahn üben", ctx, routeHash("bahn"), { kind: hasWork ? "primary" : "secondary" });
  const toCases = button("Zu den Fällen", () => ctx.back(), { kind: hasWork ? "secondary" : "primary" });
  holdBriefly([toTrain, toCases]);
  showStep(
    flow,
    viewHeader(ctx, { title: item.type === FINAL ? "Abschluss bewertet" : "Übung bewertet" }),
    error ? saveProblemCard(ctx) : null,
    item.type === FINAL ? verdictCard(entry, content) : null,
    comesBackCard(comesBack),
    bottomBar(hasWork ? [toTrain, toCases] : [toCases, toTrain]),
  );
}

// ---------- Ansicht ----------

function renderCase(container, ctx, content, params) {
  const item = content.cases.find((entry) => entry.id === params.caseId);
  if (!item || ![ROLE_LEARNER, ROLE_PATIENT].includes(params.role)) {
    container.append(
      viewHeader(ctx, { title: TITLE }),
      card(el("p", { class: "card-title" }, "Diesen Fall gibt es nicht"), el("p", null, "Wähle einen Fall aus der Liste.")),
      bottomBar(navButton("Zu den Fällen", ctx, routeHash("partner"), { kind: "primary" })),
    );
    return;
  }
  const draft = { ratings: {}, helpNote: "" };
  showRole({ container, ctx, content, item, role: params.role, revealed: false, draft, saveRating: createRatingSaver(ctx, content) });
}

export async function render(container, ctx, params) {
  const hash = params?.caseId ? routeHash("partner", params.caseId, params.role) : routeHash("partner");
  const content = await loadContentFor(container, ctx, { title: TITLE, hash });
  if (content === null) {
    return;
  }
  if (isPatientOnly(params)) {
    renderList(container, ctx, content, true);
  } else if (params?.caseId) {
    renderCase(container, ctx, content, params);
  } else {
    renderList(container, ctx, content);
  }
}
