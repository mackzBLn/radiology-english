import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createTts } from "../js/speech/tts.js";

class FakeUtterance {
  constructor(text) {
    this.text = text;
  }
}

function voice(name, lang, extra = {}) {
  return { name, lang, voiceURI: "uri." + name + "." + lang, default: false, ...extra };
}

function createSynth(voices = []) {
  const listeners = {};
  return {
    speaking: false,
    pending: false,
    voices,
    calls: [],
    spoken: [],
    getVoices() {
      return this.voices;
    },
    addEventListener(type, listener) {
      (listeners[type] ??= []).push(listener);
    },
    fire(type) {
      for (const listener of listeners[type] ?? []) {
        listener();
      }
    },
    speak(utterance) {
      this.calls.push("speak");
      this.spoken.push(utterance);
    },
    cancel() {
      this.calls.push("cancel");
    },
  };
}

function createWith(voices, options = {}) {
  const synth = createSynth(voices);
  return { synth, tts: createTts(synth, { Utterance: FakeUtterance, ...options }) };
}

const names = (voices) => voices.map((item) => item.name);

describe("listVoices", () => {
  it("behält nur englische Stimmen", () => {
    const { tts } = createWith([voice("Anna", "de-DE"), voice("Daniel", "en-GB"), voice("Rishi", "en_IN"), voice("Thomas", "fr-FR")]);
    assert.deepEqual(names(tts.listVoices()), ["Daniel", "Rishi"]);
  });

  it("entfernt alle Spaßstimmen", () => {
    const novelty = [
      "Albert", "Bad News", "Bahh", "Bells", "Boing", "Bubbles", "Cellos", "Deranged", "Fred", "Good News", "Hysterical",
      "Jester", "Junior", "Kathy", "Organ", "Ralph", "Superstar", "Trinoids", "Whisper", "Wobble", "Zarvox",
    ];
    const { tts } = createWith([...novelty.map((name) => voice(name, "en-US")), voice("Karen", "en-AU")]);
    assert.deepEqual(names(tts.listVoices()), ["Karen"]);
  });

  it("verwechselt ähnliche Namen nicht mit Spaßstimmen", () => {
    const { tts } = createWith([voice("Freddy", "en-US"), voice("Fred (Enhanced)", "en-US")]);
    assert.deepEqual(names(tts.listVoices()), ["Freddy"]);
  });

  it("entfernt Dubletten nach Name und Sprache und nach Adresse", () => {
    const { tts } = createWith([
      voice("Daniel", "en-GB", { voiceURI: "a" }),
      voice("Daniel", "en-GB", { voiceURI: "b" }),
      voice("Moira", "en-IE", { voiceURI: "c" }),
      voice("Moira Copy", "en-IE", { voiceURI: "c" }),
      voice("Daniel", "en-US", { voiceURI: "d" }),
    ]);
    assert.deepEqual(tts.listVoices().map((item) => item.voiceURI), ["a", "c", "d"]);
  });

  it("eine leere Liste bei voiceschanged überschreibt keine volle", () => {
    const { synth, tts } = createWith([voice("Daniel", "en-GB")]);
    assert.equal(tts.listVoices().length, 1);
    synth.voices = [];
    synth.fire("voiceschanged");
    assert.deepEqual(names(tts.listVoices()), ["Daniel"]);
  });

  it("füllt eine leere Liste bei voiceschanged und meldet es", () => {
    const { synth, tts } = createWith([]);
    assert.deepEqual(tts.listVoices(), []);
    let calls = 0;
    const off = tts.onVoicesChanged(() => {
      calls += 1;
    });
    synth.voices = [voice("Samantha", "en-US")];
    synth.fire("voiceschanged");
    assert.equal(calls, 1);
    assert.deepEqual(names(tts.listVoices()), ["Samantha"]);
    off();
    synth.fire("voiceschanged");
    assert.equal(calls, 1);
  });
});

describe("chooseVoice", () => {
  const all = () => [
    voice("Zoe", "en-US"),
    voice("Moira", "en-IE"),
    voice("Karen", "en-AU"),
    voice("Samantha", "en-US"),
    voice("Daniel", "en-GB"),
  ];

  it("nimmt die gewählte Stimme", () => {
    const { tts } = createWith(all());
    assert.equal(tts.chooseVoice({ voiceURI: "uri.Karen.en-AU" }).name, "Karen");
  });

  it("geht die Vorgabe der Reihe nach durch, wenn nichts gewählt ist", () => {
    const list = all();
    const { synth, tts } = createWith(list);
    assert.equal(tts.chooseVoice({ voiceURI: null }).name, "Daniel");
    synth.voices = list.filter((item) => item.name !== "Daniel");
    assert.equal(tts.chooseVoice(null).name, "Samantha");
    synth.voices = synth.voices.filter((item) => item.name !== "Samantha");
    assert.equal(tts.chooseVoice({}).name, "Karen");
    synth.voices = synth.voices.filter((item) => item.name !== "Karen");
    assert.equal(tts.chooseVoice({}).name, "Moira");
    synth.voices = synth.voices.filter((item) => item.name !== "Moira");
    assert.equal(tts.chooseVoice({}).name, "Zoe");
  });

  it("eine unbekannte gewählte Stimme fällt auf die Vorgabe zurück", () => {
    const { tts } = createWith(all());
    assert.equal(tts.chooseVoice({ voiceURI: "weg" }).name, "Daniel");
  });

  it("default zählt nicht", () => {
    const { tts } = createWith([voice("Zoe", "en-US", { default: true }), voice("Karen", "en-AU")]);
    assert.equal(tts.chooseVoice({}).name, "Karen");
  });

  it("Daniel zählt vorrangig nur mit en-GB, Samantha nur mit en-US", () => {
    const { tts } = createWith([voice("Daniel", "en-US"), voice("Samantha", "en-GB"), voice("Moira", "en-IE")]);
    assert.equal(tts.chooseVoice({}).name, "Moira");
  });

  it("ohne Stimmen null", () => {
    const { tts } = createWith([]);
    assert.equal(tts.chooseVoice({}), null);
  });
});

describe("speak", () => {
  it("ruft synth.speak im selben Aufruf, wenn nichts läuft", () => {
    const { synth, tts } = createWith([voice("Daniel", "en-GB")]);
    tts.speak("Please take a seat.");
    assert.deepEqual(synth.calls, ["speak"]);
    const [utterance] = synth.spoken;
    assert.equal(utterance.text, "Please take a seat.");
    assert.equal(utterance.rate, 1);
    assert.equal(utterance.voice.name, "Daniel");
    assert.equal(utterance.lang, "en-GB");
  });

  it("setzt das Tempo und nimmt die Stimme aus den Einstellungen", () => {
    const settings = { voiceURI: "uri.Karen.en-AU", lang: "en-US" };
    const { synth, tts } = createWith([voice("Daniel", "en-GB"), voice("Karen", "en-AU")], { getSettings: () => settings });
    tts.speak("Please take a seat.", { rate: 0.6 });
    assert.equal(synth.spoken[0].rate, 0.6);
    assert.equal(synth.spoken[0].voice.name, "Karen");
    assert.equal(synth.spoken[0].lang, "en-AU");
  });

  it("ohne Stimme gilt die Sprache aus den Einstellungen", () => {
    const { synth, tts } = createWith([], { getSettings: () => ({ lang: "en-US" }) });
    tts.speak("Please take a seat.");
    assert.equal(synth.spoken[0].voice, undefined);
    assert.equal(synth.spoken[0].lang, "en-US");
  });

  it("spricht gerade etwas: erst cancel, nach 120 ms speak", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { synth, tts } = createWith([voice("Daniel", "en-GB")]);
    synth.speaking = true;
    tts.speak("Please take a seat.");
    assert.deepEqual(synth.calls, ["cancel"]);
    t.mock.timers.tick(119);
    assert.deepEqual(synth.calls, ["cancel"]);
    t.mock.timers.tick(1);
    assert.deepEqual(synth.calls, ["cancel", "speak"]);
  });

  it("wartet auch, wenn etwas in der Warteschlange steht", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { synth, tts } = createWith([]);
    synth.pending = true;
    tts.speak("Please take a seat.");
    assert.deepEqual(synth.calls, ["cancel"]);
  });

  it("zwei schnelle Tipps: nur der letzte Satz wird gesprochen, der erste endet einmal", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { synth, tts } = createWith([]);
    synth.speaking = true;
    let firstEnded = 0;
    tts.speak("First.", { onend: () => (firstEnded += 1) });
    synth.speaking = false;
    tts.speak("Second.");
    t.mock.timers.tick(120);
    assert.deepEqual(synth.spoken.map((item) => item.text), ["Second."]);
    assert.equal(firstEnded, 1);
  });

  it("meldet Beginn und Ende, das Ende nur einmal", () => {
    const { synth, tts } = createWith([]);
    const events = [];
    tts.speak("Please take a seat.", {
      onstart: () => events.push("start"),
      onend: () => events.push("end"),
      onerror: () => events.push("error"),
    });
    const [utterance] = synth.spoken;
    utterance.onstart({});
    utterance.onend({});
    utterance.onend({});
    utterance.onerror({ error: "synthesis-failed" });
    assert.deepEqual(events, ["start", "end"]);
  });

  it("ein echter Fehler kommt bei onerror an, ein Abbruch als normales Ende", () => {
    const { synth, tts } = createWith([]);
    const events = [];
    const callbacks = { onend: () => events.push("end"), onerror: (event) => events.push(event.error) };
    tts.speak("One.", callbacks);
    synth.spoken[0].onerror({ error: "synthesis-failed" });
    tts.speak("Two.", callbacks);
    synth.spoken[1].onerror({ error: "interrupted" });
    tts.speak("Three.", callbacks);
    synth.spoken[2].onerror({ error: "canceled" });
    assert.deepEqual(events, ["synthesis-failed", "end", "end"]);
  });

  it("eine neue Ausgabe beendet die laufende für die Ansicht, späte Ereignisse zählen nicht", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { synth, tts } = createWith([]);
    const events = [];
    tts.speak("First.", { onstart: () => events.push("start first"), onend: () => events.push("end first") });
    const [first] = synth.spoken;
    synth.speaking = true;
    tts.speak("Second.", { onend: () => events.push("end second") });
    assert.deepEqual(events, ["end first"]);
    first.onstart({});
    first.onend({});
    assert.deepEqual(events, ["end first"]);
  });

  it("nach dem Ende spricht der nächste Satz wieder direkt", () => {
    const { synth, tts } = createWith([]);
    tts.speak("One.");
    synth.spoken[0].onend({});
    tts.speak("Two.");
    assert.deepEqual(synth.calls, ["speak", "speak"]);
  });
});

describe("cancel", () => {
  it("bricht eine wartende Ausgabe ab, sie startet nicht mehr", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { synth, tts } = createWith([]);
    synth.speaking = true;
    let ended = 0;
    tts.speak("Please take a seat.", { onend: () => (ended += 1) });
    synth.speaking = false;
    tts.cancel();
    t.mock.timers.tick(500);
    assert.deepEqual(synth.spoken, []);
    assert.equal(ended, 1);
  });

  it("stoppt die laufende Ausgabe", () => {
    const { synth, tts } = createWith([]);
    tts.speak("Please take a seat.");
    synth.speaking = true;
    tts.cancel();
    assert.deepEqual(synth.calls, ["speak", "cancel"]);
  });

  it("lässt die Sprachausgabe in Ruhe, wenn nichts läuft", () => {
    const { synth, tts } = createWith([]);
    tts.cancel();
    assert.deepEqual(synth.calls, []);
  });
});

describe("ohne Sprachausgabe", () => {
  it("wirft nichts und meldet den Ausfall", () => {
    const tts = createTts(null);
    assert.deepEqual(tts.listVoices(), []);
    assert.equal(tts.chooseVoice({}), null);
    assert.equal(tts.isSpeaking(), false);
    let error = null;
    tts.speak("Please take a seat.", { onerror: (event) => (error = event.error) });
    assert.equal(error, "unavailable");
    tts.cancel();
  });

  it("die Vorgabe ist globalThis.speechSynthesis", () => {
    const synth = createSynth([voice("Daniel", "en-GB")]);
    const previous = globalThis.speechSynthesis;
    globalThis.speechSynthesis = synth;
    try {
      assert.deepEqual(names(createTts().listVoices()), ["Daniel"]);
    } finally {
      globalThis.speechSynthesis = previous;
    }
  });
});
