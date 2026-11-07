/*
 * Sprechen üben: eine Runde aus planSpeech, ein Sprechschritt je Satz, neu geladen wird beim Tipp auf „Weiter“ (Gerätetest Lauf 3 und 4).
 * Nach dem Neuladen kommt alles aus der Sitzung, die Inhaltsdaten werden dafür nicht geladen. Gewertet wird sofort beim Ergebnis.
 * Der Speicher hat nur einen Platz für eine Sitzung. Eine andere Sprechrunde wird ersetzt, ein offener Einstufungstest erst nach Rückfrage.
 */

import {
  advance,
  createSpeechSession,
  currentTask,
  gradeOnce,
  needsGrading,
  sessionFits,
  setStepState,
  stepStateOf,
  summaryOf,
} from "../../core/speak-flow.js";
import { recognitionUsedOnThisPage } from "../../speech/recognizer.js";
import { backButton, bottomBar, button, card, navButton, progressBar, viewHeader, waitNote } from "../components.js";
import { el } from "../dom.js";
import { routeHash } from "../router.js";
import { isSpeechAvailable, reloadPage, renderSpeakStep, speechMissingCard } from "../speak-step.js";

const TITLE = "Sprechen";
const PLACEMENT_KIND = "placement";

function ownHash(focus) {
  return focus ? routeHash("sprechen", focus) : routeHash("sprechen");
}

function countText(count) {
  return count === 1 ? "1 Satz" : count + " Sätze";
}

// ---------- Hinweise ohne Übung ----------

function showMissing(container, ctx, focus) {
  container.append(
    viewHeader(ctx, { title: TITLE }),
    speechMissingCard(el("p", null, "Bis dahin kannst du in der Bahn üben.")),
    bottomBar(navButton("In der Bahn üben", ctx, focus ? routeHash("bahn", focus) : routeHash("bahn"), { kind: "primary" }), backButton(ctx)),
  );
}

function showNothing(container, ctx, focus) {
  container.append(
    viewHeader(ctx, { title: TITLE }),
    card(
      el("h2", { class: "card-title" }, "Gerade gibt es hier nichts zu sprechen"),
      el("p", null, focus ? "In diesem Bereich ist für heute alles gesprochen. Du kannst alle Sätze üben." : "Für heute ist alles gesprochen. Komm wieder, wenn Sätze fällig sind."),
    ),
    bottomBar(focus ? navButton("Alles üben", ctx, routeHash("sprechen"), { kind: "primary" }) : navButton("In der Bahn üben", ctx, routeHash("bahn"), { kind: "primary" }), backButton(ctx)),
  );
}

function showPlacementOpen(container, ctx, focus) {
  container.append(
    viewHeader(ctx, { title: TITLE }),
    card(
      el("h2", { class: "card-title" }, "Dein Einstufungstest ist noch offen"),
      el("p", null, "Wenn du jetzt Sprechen übst, beginnt der Test später von vorn."),
    ),
    bottomBar(
      navButton("Zum Test", ctx, routeHash("einstufung"), { kind: "primary" }),
      button("Trotzdem üben", () => {
        ctx.store.clearSession();
        ctx.navigate(ownHash(focus));
      }),
    ),
  );
}

// ---------- Zusammenfassung ----------

function showSummary(container, ctx, session) {
  const summary = summaryOf(session);
  const lines = [
    ["Gut verständlich", summary.understood],
    ["Teilweise verständlich", summary.partly],
    ["Nicht erkannt", summary.notUnderstood],
  ];
  container.replaceChildren(
    viewHeader(ctx, { title: TITLE }),
    card(
      el("h2", { class: "card-title" }, summary.spoken > 0 ? "Runde geschafft" : "Runde beendet"),
      el("p", null, summary.spoken > 0 ? "Du hast " + countText(summary.spoken) + " gesprochen." : "In dieser Runde wurde noch kein Satz gewertet."),
      summary.spoken > 0
        ? el("dl", { class: "facts" }, lines.map(([name, value]) => [el("dt", null, name), el("dd", null, String(value))]))
        : null,
      summary.comesBack > 0 ? el("p", null, "Was noch nicht saß, kommt morgen wieder.") : null,
      summary.notMeasured > 0 ? el("p", { class: "muted" }, "Hat nicht geklappt: " + countText(summary.notMeasured) + ". Das zählt nicht als Fehler.") : null,
    ),
    bottomBar(
      button("Noch eine Runde", () => ctx.navigate(ownHash(session.focus)), { kind: "primary" }),
      navButton("Zur Startseite", ctx, "#/"),
    ),
  );
}

// ---------- Runde ----------

function runRound(container, ctx, session) {
  const grade = () =>
    gradeOnce({
      session,
      state: ctx.state,
      today: ctx.today(),
      now: ctx.now(),
      saveState: () => ctx.save(),
      saveSession: (value) => ctx.store.saveSession(value),
    });

  // Endete die App zwischen Ergebnis und Wertung, kommt die Wertung jetzt. Sonst ändert das nichts.
  if (needsGrading(session)) {
    grade();
  }

  // Lief die Erkennung auf dieser Seite schon, bringt der nächste Start oft keine Sprache (Gerätetest Lauf 3, Befund 1).
  if (!session.result && recognitionUsedOnThisPage()) {
    container.append(waitNote());
    reloadPage();
    return undefined;
  }

  let step = null;

  function finish() {
    step?.destroy();
    step = null;
    ctx.store.clearSession();
    showSummary(container, ctx, session);
  }

  const total = session.queue.length;
  container.append(
    viewHeader(ctx, {
      title: TITLE,
      right: button("Beenden", finish, { kind: "ghost", style: "flex:0 0 auto;width:auto" }),
    }),
    el(
      "div",
      { class: "stack" },
      el("p", { class: "progress-text" }, "Satz " + (session.index + 1) + " von " + total),
      progressBar(session.index, total),
    ),
  );

  step = renderSpeakStep(container, ctx, {
    task: currentTask(session),
    saved: stepStateOf(session),
    nextLabel: session.index + 1 < total ? "Weiter" : "Fertig",
    showSoundHint: session.index === 0,
    // Der Satz zur Verständlichkeit einmal je Runde, bei der ersten Rückmeldung.
    showMeasureNote: () => summaryOf(session).spoken <= 1,
    onChange: (stepState) => {
      setStepState(session, stepState);
      ctx.store.saveSession(session);
    },
    onResult: grade,
    onNext: () => {
      if (advance(session)) {
        ctx.store.saveSession(session);
        reloadPage();
      } else {
        finish();
      }
    },
  });

  return () => step?.destroy();
}

async function startRound(container, ctx, focus) {
  const header = viewHeader(ctx, { title: TITLE });
  const wait = waitNote();
  container.append(header, wait);
  // Der Plan wird nur hier gebraucht. Das Neuladen je Satz kommt ohne ihn aus (Startzeit zählt, Vorgabe).
  const { planSpeech } = await import("../../core/planner.js");
  const content = await ctx.getContent();
  if (!container.isConnected) {
    return undefined; // Inzwischen ist eine andere Ansicht offen.
  }
  header.remove();
  wait.remove();
  const queue = planSpeech({ content, state: ctx.state, today: ctx.today(), rng: Math.random, focus });
  if (queue.length === 0) {
    showNothing(container, ctx, focus);
    return undefined;
  }
  const session = createSpeechSession({ queue, focus, appVersion: ctx.version });
  ctx.store.saveSession(session);
  return runRound(container, ctx, session);
}

export async function render(container, ctx, params) {
  const focus = params?.focus ?? null;
  if (!isSpeechAvailable()) {
    showMissing(container, ctx, focus);
    return undefined;
  }
  const stored = ctx.store.loadSession();
  if (sessionFits(stored, { focus, appVersion: ctx.version })) {
    return runRound(container, ctx, stored);
  }
  if (stored?.kind === PLACEMENT_KIND) {
    showPlacementOpen(container, ctx, focus);
    return undefined;
  }
  return startRound(container, ctx, focus);
}
