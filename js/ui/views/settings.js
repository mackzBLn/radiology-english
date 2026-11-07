/*
 * Einstellungen: Stimme mit Hörprobe, Sprache der Erkennung, Tempo für „Langsam“ und der Technik-Bericht für Tests am Gerät.
 * Der Bericht enthält keine Inhalte und keine Namen und wird nur auf Tipp in die Zwischenablage kopiert.
 * Quellen:
 *   https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persisted
 *   https://developer.mozilla.org/en-US/docs/Web/API/Navigator/onLine
 *   https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/select
 */

import { audioButton, backButton, bottomBar, card, copyButton, hint, viewHeader } from "../components.js";
import { el } from "../dom.js";

const SAMPLE_TEXT = "Hello. This is how I sound.";
const RECOGNITION_LANGS = [
  { value: "en-GB", label: "Britisch (en-GB)" },
  { value: "en-US", label: "Amerikanisch (en-US)" },
];
const SLOW_RATES = [
  { rate: 0.5, label: "Sehr langsam" },
  { rate: 0.6, label: "Langsam" },
  { rate: 0.7, label: "Mäßig langsam" },
  { rate: 0.8, label: "Etwas langsamer" },
];

function voiceOptions(ctx) {
  const automatic = ctx.tts.chooseVoice({ voiceURI: null });
  const chosenUri = ctx.state.settings.voiceURI;
  return [
    el("option", { value: "", selected: !chosenUri }, automatic ? "Automatisch (" + automatic.name + ")" : "Automatisch"),
    ...ctx.tts.listVoices().map((voice) =>
      el("option", { value: voice.voiceURI, selected: voice.voiceURI === chosenUri }, voice.name + " (" + voice.lang + ")"),
    ),
  ];
}

function voiceCard(ctx, onChange) {
  const select = el("select", {
    class: "input",
    "aria-label": "Stimme",
    onchange: () => {
      ctx.state.settings.voiceURI = select.value || null;
      ctx.save();
      onChange();
    },
  });
  const noVoice = hint("Keine englische Stimme gefunden. Die Aussprache kann falsch klingen.", "warn");
  const fill = () => {
    select.replaceChildren(...voiceOptions(ctx));
    noVoice.hidden = ctx.tts.listVoices().length > 0;
  };
  fill();
  return {
    node: card(
      el("p", { class: "card-title" }, "Stimme"),
      noVoice,
      select,
      audioButton(SAMPLE_TEXT, ctx, { label: "Hörprobe" }),
    ),
    fill,
  };
}

function languageCard(ctx) {
  const select = el(
    "select",
    {
      class: "input",
      "aria-label": "Deine Aussprache wird erkannt als",
      onchange: () => {
        ctx.state.settings.lang = select.value;
        ctx.save();
      },
    },
    RECOGNITION_LANGS.map(({ value, label }) => el("option", { value, selected: value === ctx.state.settings.lang }, label)),
  );
  return card(
    el("p", { class: "card-title" }, "Deine Aussprache wird erkannt als"),
    el("p", { class: "muted" }, "Wähle, was du eher sprichst. Beim Üben gelten britisch und amerikanisch beide."),
    select,
  );
}

// Der Tipp wählt das Tempo und spielt gleich die Hörprobe, direkt im Tipp. Der Knopf zeigt, solange sie läuft.
function rateCard(ctx) {
  const buttons = new Map();
  const markChosen = () => {
    for (const [rate, node] of buttons) {
      const chosen = rate === ctx.state.settings.slowRate;
      node.classList.toggle("btn-primary", chosen);
      node.classList.toggle("btn-secondary", !chosen);
      node.setAttribute("aria-pressed", String(chosen));
    }
  };
  for (const { rate, label } of SLOW_RATES) {
    buttons.set(rate, audioButton(SAMPLE_TEXT, ctx, {
      label,
      rate,
      kind: "secondary",
      onTap: () => {
        ctx.state.settings.slowRate = rate;
        ctx.save();
        markChosen();
      },
    }));
  }
  markChosen();
  return card(
    el("p", { class: "card-title" }, "Tempo für „Langsam“"),
    el("p", { class: "muted" }, "Ein Tipp wählt das Tempo und spielt es vor."),
    el("div", { class: "tile-grid" }, [...buttons.values()]),
  );
}

async function buildReport(ctx) {
  const workerVersion = await ctx.worker.version();
  let persisted = "unbekannt";
  try {
    persisted = String(await navigator.storage.persisted());
  } catch {
    // Bleibt „unbekannt“.
  }
  const chosen = ctx.tts.chooseVoice(ctx.state.settings);
  return [
    "Version App: " + ctx.version,
    "Version Service Worker: " + (workerVersion ?? "keiner aktiv"),
    "navigator.standalone: " + String(navigator.standalone),
    "storage.persisted: " + persisted,
    "Englische Stimmen: " + ctx.tts.listVoices().length,
    "Gewählte Stimme: " + (chosen ? chosen.name + " (" + chosen.lang + ")" : "keine"),
    "webkitSpeechRecognition: " + ("webkitSpeechRecognition" in globalThis ? "ja" : "nein"),
    "navigator.onLine: " + String(navigator.onLine),
    "Gespeicherte Einheiten: " + Object.keys(ctx.state.units).length,
    "Letzte Sicherung: " + (ctx.state.backup.lastAt ?? "noch keine"),
  ].join("\n");
}

export async function render(container, ctx) {
  const reportNode = el("pre", { class: "pre-text" }, "Einen Moment …");
  let reportText = "";
  let left = false;

  async function refreshReport() {
    const text = await buildReport(ctx);
    if (!left) {
      reportText = text;
      reportNode.textContent = text;
    }
  }

  const voices = voiceCard(ctx, refreshReport);
  const stopWatching = ctx.tts.onVoicesChanged(() => {
    voices.fill();
    refreshReport();
  });

  container.append(
    viewHeader(ctx, { title: "Einstellungen" }),
    voices.node,
    languageCard(ctx),
    rateCard(ctx),
    card(
      el("p", { class: "card-title" }, "Technik-Bericht"),
      reportNode,
      copyButton(() => reportText),
    ),
    bottomBar(backButton(ctx)),
  );
  refreshReport();

  return () => {
    left = true;
    stopWatching();
  };
}
