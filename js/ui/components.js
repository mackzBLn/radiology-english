/*
 * Bausteine der Oberfläche.
 *
 * So baust du eine Ansicht, eine Datei js/ui/views/<name>.js:
 *
 *   export async function render(container, ctx, params) {
 *     container.append(
 *       viewHeader(ctx, { title: "Titel" }),
 *       card(el("p", null, "Inhalt")),
 *       bottomBar(button("Weiter", onNext, { kind: "primary" })),
 *     );
 *     return () => { aufräumen };   // optional, läuft beim Verlassen der Ansicht
 *   }
 *
 * - container ist für jeden Aufruf neu und trägt die Klasse view. Was eine Ansicht nach dem Verlassen noch anhängt, ist unsichtbar.
 * - Zurück: viewHeader oben in jede Ansicht außer der Startseite. Fehlt er, setzt der Router einen ein.
 *   ctx.back() geht einen Schritt zurück, viewHeader(ctx, { onBack }) ersetzt das, right zeigt etwas rechts daneben (etwa .timer).
 * - Hauptknöpfe: bottomBar als letzter Baustein, nebeneinander mit barRow. Bahn: container.classList.add("large-targets").
 *   Ansichten ohne Übung bekommen unten zusätzlich backButton(ctx), denn sie werden einhändig bedient.
 * - card(...kinder) oder card({ class: "card-warn" }, ...kinder). Rückfrage: confirmDialog(knopf, { title, body, confirmLabel, onConfirm }).
 * - params: #/abschnitt/<id> { id }; #/bahn/<fokus> und #/sprechen/<fokus> { focus }; #/partner/<caseId>/<rolle> { caseId, role }.
 *   Ohne diesen Teil der Route ist das Feld undefined. Die Route baust du mit routeHash aus router.js.
 * - ctx: state, store, save(), getContent(), tts, navigate(hash), back(), version, today(), now(), loadError, replaceState(state), worker.
 *   Nach jeder Änderung am Lernstand ctx.save(). ctx.state immer neu lesen, Einlesen einer Sicherung ersetzt ihn.
 * - Inhaltsdaten nur, wenn nötig: container.append(waitNote()), dann await ctx.getContent(), dann waitNote wieder entfernen.
 *   Quellen: infoButton(content.source(unit.source)). Englische Sätze zeigen ihn immer.
 * - Ton: ctx.tts.speak oder audioButton immer direkt im Tipp, ohne await davor. Langsam: audioButton(text, ctx, { label: "Langsam", rate: ctx.state.settings.slowRate }).
 * - Texte englisch: englishText. Eingabefeld für Englisch: el("input", { class: "input", autocorrect: "off", autocapitalize: "off", spellcheck: "false" }).
 *   Jedes Freitextfeld bekommt noPatientDataHint().
 * - Klassen stehen oben in css/app.css. Farben nur von dort, keine eigenen Werte.
 *
 * Quellen:
 *   https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog
 *   https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement/showModal
 *   https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText
 *   https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/noopener
 */

import { el, isAttrs } from "./dom.js";
import { toDateString } from "../core/dates.js";

// ---------- Knöpfe ----------

// kind: primary, secondary, ghost, danger oder option. Weitere Attribute wie bei el, class kommt dazu.
export function button(label, onClick, { kind = "secondary", class: extraClass, ...attrs } = {}) {
  const className = ["btn", "btn-" + kind, extraClass].filter(Boolean).join(" ");
  return el("button", { type: "button", class: className, onclick: onClick, ...attrs }, label);
}

export function navButton(label, ctx, hash, options) {
  return button(label, () => ctx.navigate(hash), options);
}

// Beginnt die Ausgabe bis dahin nicht, gilt sie als verworfen. iOS kann das still tun (Vorgabe aus dem Gerätetest).
const SPEECH_START_LIMIT_MS = 5000;

// Zeigt schon beim Tipp, dass die App spricht: Die Ausgabe kann rund 1,2 s verzögert sein (Vorgabe aus dem Gerätetest).
// kind wie bei button, onTap läuft im Tipp vor der Ausgabe.
export function audioButton(text, ctx, { label = "Anhören", rate = 1, kind = "audio", onTap } = {}) {
  let run = 0;
  let startTimer = null;
  const node = el("button", { type: "button", class: "btn btn-" + kind }, label);

  function finish(id, nextLabel) {
    if (id === run) { // ein älterer Lauf darf den Knopf nicht zurücksetzen
      clearTimeout(startTimer);
      node.classList.remove("is-speaking");
      node.textContent = nextLabel;
    }
  }

  node.addEventListener("click", () => {
    run += 1;
    const id = run;
    clearTimeout(startTimer);
    onTap?.();
    node.classList.add("is-speaking");
    node.textContent = "Spricht …";
    startTimer = setTimeout(() => finish(id, "Nochmal tippen"), SPEECH_START_LIMIT_MS);
    ctx.tts.speak(text, {
      rate,
      onstart: () => {
        if (id === run) {
          clearTimeout(startTimer);
        }
      },
      onend: () => finish(id, label),
      onerror: () => finish(id, "Nochmal tippen"),
    });
  });
  return node;
}

// Zweiter Rückweg in der unteren Leiste, für die Hand unten am Gerät. Oben bleibt der Knopf aus viewHeader (Vorgabe).
export function backButton(ctx) {
  return button("Zurück", () => ctx.back());
}

export function copyButton(getText, { label = "Text kopieren" } = {}) {
  const node = el("button", { type: "button", class: "btn btn-secondary" }, label);
  node.addEventListener("click", async () => {
    let copied = false;
    try {
      await navigator.clipboard.writeText(getText());
      copied = true;
    } catch {
      // Der Text steht sichtbar auf der Seite und lässt sich von Hand markieren.
    }
    node.textContent = copied ? "Kopiert" : "Bitte den Text markieren und kopieren";
    setTimeout(() => {
      node.textContent = label;
    }, 2500);
  });
  return node;
}

// ---------- Aufbau ----------

export function viewHeader(ctx, { title, onBack, right } = {}) {
  return el(
    "header",
    { class: "view-header" },
    el(
      "button",
      {
        type: "button",
        class: "btn btn-back",
        dataset: { back: "" },
        onclick: () => (onBack ? onBack() : ctx.back()),
      },
      "Zurück",
    ),
    title ? el("h1", { class: "view-title" }, title) : null,
    right ?? null,
  );
}

export function card(first, ...rest) {
  if (isAttrs(first)) {
    const { class: extraClass, ...attrs } = first;
    return el("div", { class: extraClass ? "card " + extraClass : "card", ...attrs }, ...rest);
  }
  return el("div", { class: "card" }, first, ...rest);
}

export function bottomBar(...buttons) {
  return el("div", { class: "bottom-bar" }, ...buttons);
}

export function barRow(...buttons) {
  return el("div", { class: "bottom-bar-row" }, ...buttons);
}

export function englishText(text, tag = "p") {
  return el(tag, { class: "sentence-en", lang: "en" }, text);
}

export function waitNote(text = "Einen Moment …") {
  return el("p", { class: "muted", role: "status" }, text);
}

// Aus span, damit der Balken auch in einem Knopf stehen darf. practiced zeigt als zweite Stufe, was schon geübt, aber noch nicht gelernt ist.
export function progressBar(done, total, practiced = done) {
  const percent = (value) => (total > 0 ? Math.round((value / total) * 100) : 0);
  const twoStages = practiced > done;
  return el(
    "span",
    {
      class: twoStages ? "progress progress-two" : "progress",
      role: "progressbar",
      "aria-valuemin": "0",
      "aria-valuemax": String(total),
      "aria-valuenow": String(done),
    },
    el("span", { class: "progress-fill", style: "width:" + percent(done) + "%" }),
    twoStages ? el("span", { class: "progress-practiced", style: "width:" + percent(practiced - done) + "%" }) : null,
  );
}

// ---------- Hinweise ----------

// tone: info, ok, warn oder error.
export function hint(text, tone = "info") {
  return el("p", { class: "hint hint-" + tone }, text);
}

export function clinicNote() {
  return hint("In deiner Klinik kann das anders sein.", "warn");
}

// Für lange Listen: Oben steht ein Hinweis auf die Marke, die Karte trägt nur die Marke. Der Tipp sagt, was zu klären ist.
export function clinicMark(noteDe = null) {
  const label = "Klinikabhängig";
  const node = el("button", { type: "button", class: "btn btn-clinic" }, label);
  node.addEventListener("click", () =>
    openDialog(node, label, clinicNote(), el("p", null, noteDe ?? "Frag in deiner Klinik nach, wie es dort gemacht wird.")),
  );
  return node;
}

export function noPatientDataHint() {
  return hint("Keine Patientendaten eingeben", "warn");
}

// Ein not, never oder no fehlt oder kommt dazu. Bei Sicherheitssätzen ist das das Gegenteil des Ziels.
export function negationNote() {
  return hint("Achte auf „not“ und „no“: Diese Wörter drehen den Sinn des Satzes um.", "warn");
}

export function soundHint() {
  return hint("Kein Ton? Stummmodus ausschalten.");
}

// ---------- Dialog und Quelle ----------

// Der Dialog hängt in der Ansicht und verschwindet mit ihr. Er bleibt im Dokument, bis er geschlossen wird.
function showDialog(anchor, title, children, closeLabel) {
  const dialog = el(
    "dialog",
    { class: "dialog" },
    el("h2", null, title),
    children,
    el("button", { type: "button", class: "btn btn-primary", autofocus: true, onclick: () => dialog.close() }, closeLabel),
  );
  dialog.addEventListener("close", () => dialog.remove());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      dialog.close();
    }
  });
  (anchor?.closest(".view") ?? document.body).append(dialog);
  dialog.showModal();
  return dialog;
}

// anchor ist ein Element der Ansicht, etwa der angetippte Knopf.
export function openDialog(anchor, title, ...children) {
  return showDialog(anchor, title, children, "Schließen");
}

// Nachfrage vor etwas, das sich nicht von selbst rückgängig macht. Tippen daneben oder auf cancelLabel bricht ab.
export function confirmDialog(anchor, { title, body = [], confirmLabel, cancelLabel = "Abbrechen", onConfirm }) {
  const dialog = showDialog(
    anchor,
    title,
    [
      body,
      button(confirmLabel, () => {
        dialog.close();
        onConfirm();
      }, { kind: "danger" }),
    ],
    cancelLabel,
  );
  return dialog;
}

function sourceFacts(source) {
  // access search: Die Seite war nur über die Suche zu lesen, abgerufen wurde sie nie.
  const facts = [
    ["Titel", source.title ?? source.ref],
    ["Herausgeber", source.publisher],
    ["Stelle", source.locator],
    [source.access === "search" ? "Über die Suche gelesen" : "Abgerufen", source.retrieved ? formatDate(source.retrieved) : null],
  ];
  return el(
    "dl",
    { class: "facts" },
    facts.filter(([, value]) => value).map(([name, value]) => [el("dt", null, name), el("dd", null, value)]),
  );
}

// source: das Ergebnis von content.source(unit.source). Der Link öffnet ein eigenes Fenster, die App bleibt stehen.
export function infoButton(source) {
  const node = el("button", { type: "button", class: "btn btn-info", "aria-label": "Quelle anzeigen" }, "i");
  node.addEventListener("click", () => {
    const body = source
      ? [
          sourceFacts(source),
          source.url
            ? el("a", { class: "btn btn-secondary", href: source.url, target: "_blank", rel: "noopener" }, "Quelle öffnen")
            : null,
        ]
      : [el("p", null, "Zu diesem Satz ist keine Quelle hinterlegt.")];
    openDialog(node, "Quelle", ...body);
  });
  return node;
}

// ---------- Ansicht, die es noch nicht gibt ----------

// detail ist die technische Meldung des Browsers, die sieht die Nutzerin nicht.
export function renderComingSoon(container, ctx, detail) {
  if (detail) {
    console.warn(detail);
  }
  container.append(
    viewHeader(ctx),
    card(
      el("h2", null, "Kommt noch"),
      el("p", { class: "muted" }, "Diesen Teil der App gibt es noch nicht."),
    ),
    bottomBar(backButton(ctx)),
  );
}

// ---------- Datum ----------

// "2026-11-07" oder eine ISO-Zeit wird zu 07.11.2026, in lokaler Zeit.
export function formatDate(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return day + "." + month + "." + year;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : formatDate(toDateString(date));
}
