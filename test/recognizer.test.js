import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createRecognizer, recognitionUsedOnThisPage, timingsFor } from "../js/speech/recognizer.js";

function fakeClass({ throwOnStart = false, throwOnConstruct = false, onAbort = null, onStop = null } = {}) {
  const instances = [];
  class FakeRecognition {
    constructor() {
      if (throwOnConstruct) {
        throw new TypeError("kaputt");
      }
      this.calls = [];
      instances.push(this);
    }
    start() {
      this.calls.push("start");
      if (throwOnStart) {
        throw new Error("schon gestartet");
      }
    }
    stop() {
      this.calls.push("stop");
      onStop?.(this);
    }
    abort() {
      this.calls.push("abort");
      onAbort?.(this);
    }
    fire(name, payload = {}) {
      this["on" + name]?.(payload);
    }
    result(text, isFinal = false) {
      this.fire("result", { results: [Object.assign([{ transcript: text, confidence: 0 }], { isFinal })] });
    }
  }
  return { FakeRecognition, instances };
}

function setup(t, options) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const { FakeRecognition, instances } = fakeClass(options);
  const states = [];
  const recognizer = createRecognizer(FakeRecognition);
  const promise = recognizer.listen({ lang: "en-GB", onState: (name) => states.push(name), noSpeechMs: 6000, limitMs: 20000, pauseMs: 1500 });
  return { recognizer, promise, states, instances, one: instances[0], tick: (ms) => t.mock.timers.tick(ms) };
}

describe("Spracherkennung: Verfügbarkeit und Start", () => {
  it("meldet fehlende Schnittstelle als notMeasured, ohne zu werfen", async () => {
    const recognizer = createRecognizer(null);
    assert.equal(recognizer.isAvailable(), false);
    const result = await recognizer.listen({ lang: "en-GB" });
    assert.equal(result.status, "notMeasured");
    assert.equal(result.reason, "unavailable");
    assert.equal(result.transcript, "");
  });

  it("ist verfügbar, wenn die Klasse da ist", () => {
    const { FakeRecognition } = fakeClass();
    assert.equal(createRecognizer(FakeRecognition).isAvailable(), true);
  });

  it("stellt die Vorgaben ein und nimmt die Sprache aus dem Aufruf", (t) => {
    const { one } = setup(t);
    assert.equal(one.lang, "en-GB");
    assert.equal(one.continuous, false);
    assert.equal(one.interimResults, true);
    assert.equal(one.maxAlternatives, 1);
  });

  it("baut je Lauf eine neue Instanz", async (t) => {
    const { recognizer, instances, one, promise } = setup(t);
    one.fire("audiostart");
    one.fire("end");
    await promise;
    const second = recognizer.listen({ lang: "en-US" });
    assert.equal(instances.length, 2);
    assert.notEqual(instances[1], one);
    assert.equal(instances[1].lang, "en-US");
    instances[1].fire("end");
    await second;
  });

  it("ruft start direkt im Aufruf auf, ohne await davor", (t) => {
    const { one } = setup(t);
    assert.deepEqual(one.calls, ["start"]);
    assert.equal(recognitionUsedOnThisPage(), true);
  });

  it("meldet einen Start, der wirft, als notMeasured", async (t) => {
    const { promise } = setup(t, { throwOnStart: true });
    const result = await promise;
    assert.equal(result.status, "notMeasured");
    assert.equal(result.reason, "startFailed");
  });

  it("meldet einen Konstruktor, der wirft, als notMeasured", async (t) => {
    const { promise } = setup(t, { throwOnConstruct: true });
    const result = await promise;
    assert.equal(result.reason, "startFailed");
  });

  it("nennt die Zeiten je Stufe", () => {
    assert.deepEqual(timingsFor("a"), { noSpeechMs: 6000, limitMs: 20000, pauseMs: 2500 });
    assert.deepEqual(timingsFor("b"), { noSpeechMs: 10000, limitMs: 20000, pauseMs: 2500 });
  });
});

describe("Spracherkennung: Zustände und Zeit ohne Sprache", () => {
  it("meldet starting vor dem Start und listening erst bei audiostart", (t) => {
    const { states, one, tick } = setup(t);
    assert.deepEqual(states, ["starting"]);
    tick(2500);
    assert.deepEqual(states, ["starting"]);
    one.fire("start");
    assert.deepEqual(states, ["starting"]);
    one.fire("audiostart");
    assert.deepEqual(states, ["starting", "listening"]);
  });

  it("zählt die Zeit ohne Sprache ab audiostart, auch wenn der spät kommt", async (t) => {
    const { one, tick, promise } = setup(t);
    tick(5000);
    one.fire("audiostart");
    tick(5999);
    assert.deepEqual(one.calls, ["start"]);
    tick(1);
    assert.deepEqual(one.calls, ["start", "abort"]);
    const result = await promise;
    assert.equal(result.status, "notMeasured");
    assert.equal(result.reason, "noSpeech");
  });

  it("lässt den Fehler aborted nach dem eigenen abort den Grund nicht ersetzen", async (t) => {
    const { one, tick, promise } = setup(t, {
      onAbort(instance) {
        instance.fire("error", { error: "aborted" });
        instance.fire("end");
      },
    });
    one.fire("audiostart");
    tick(6000);
    const result = await promise;
    assert.equal(result.reason, "noSpeech");
    assert.equal(one.calls.filter((call) => call === "abort").length, 1);
  });

  it("bricht nicht ab, wenn speechstart rechtzeitig kommt", (t) => {
    const { one, tick, states } = setup(t);
    one.fire("audiostart");
    tick(3000);
    one.fire("speechstart");
    assert.deepEqual(states, ["starting", "listening", "hearing"]);
    tick(6000);
    assert.deepEqual(one.calls, ["start"]);
  });

  it("zählt ein Ergebnis ohne speechstart als Sprache", (t) => {
    const { one, tick } = setup(t);
    one.fire("audiostart");
    tick(1000);
    one.result("the bus");
    tick(1000);
    assert.deepEqual(one.calls, ["start"]);
  });

  it("meldet doppeltes audiostart nur einmal und setzt die Zeit nicht zurück", (t) => {
    const { one, tick, states } = setup(t);
    one.fire("audiostart");
    tick(4000);
    one.fire("audiostart");
    assert.deepEqual(states, ["starting", "listening"]);
    tick(2000);
    assert.deepEqual(one.calls, ["start", "abort"]);
  });
});

describe("Spracherkennung: Fehlercodes", () => {
  for (const code of ["audio-capture", "aborted", "no-speech", "not-allowed", "service-not-allowed", "network"]) {
    it("wertet " + code + " als notMeasured mit Grund", async (t) => {
      const { one, promise } = setup(t);
      one.fire("start");
      one.fire("error", { error: code });
      one.fire("end");
      const result = await promise;
      assert.equal(result.status, "notMeasured");
      assert.equal(result.reason, code);
    });
  }

  it("zählt einen Fehler mitten im Sprechen nicht, auch wenn schon Text da ist", async (t) => {
    const { one, promise } = setup(t);
    one.fire("audiostart");
    one.fire("speechstart");
    one.result("the bus");
    one.fire("error", { error: "audio-capture" });
    const result = await promise;
    assert.equal(result.status, "notMeasured");
    assert.equal(result.reason, "audio-capture");
  });

  it("behält den Text, wenn der Fehler erst nach stop kommt", async (t) => {
    const { one, promise } = setup(t);
    one.fire("audiostart");
    one.fire("speechstart");
    one.result("the bus leaves");
    one.fire("speechend");
    one.fire("error", { error: "aborted" });
    one.fire("end");
    const result = await promise;
    assert.equal(result.status, "heard");
    assert.equal(result.transcript, "the bus leaves");
  });

  it("meldet einen Fehler nach stop ohne Text als notMeasured", async (t) => {
    const { one, promise } = setup(t);
    one.fire("audiostart");
    one.fire("speechstart");
    one.fire("speechend");
    one.fire("error", { error: "no-speech" });
    const result = await promise;
    assert.equal(result.status, "notMeasured");
    assert.equal(result.reason, "no-speech");
  });
});

describe("Spracherkennung: Ende und Endergebnis", () => {
  it("wertet das letzte Zwischenergebnis, wenn kein Endergebnis kommt", async (t) => {
    const { one, tick, promise } = setup(t);
    one.fire("audiostart");
    one.fire("speechstart");
    one.result("the bus");
    one.result("the bus leaves at nine");
    tick(1499);
    assert.deepEqual(one.calls, ["start"]);
    tick(1);
    assert.deepEqual(one.calls, ["start", "stop"]);
    tick(2999);
    assert.deepEqual(one.calls, ["start", "stop"], "Das Endergebnis bekommt 3000 ms wie im Gerätetest");
    tick(1);
    const result = await promise;
    assert.equal(result.status, "heard");
    assert.equal(result.transcript, "the bus leaves at nine");
    assert.deepEqual(one.calls, ["start", "stop", "abort"]);
  });

  it("setzt die Pause mit jedem neuen Ergebnis zurück", (t) => {
    const { one, tick } = setup(t);
    one.fire("audiostart");
    one.result("the");
    tick(1000);
    one.result("the bus");
    tick(1000);
    assert.deepEqual(one.calls, ["start"]);
    tick(500);
    assert.deepEqual(one.calls, ["start", "stop"]);
  });

  it("ruft nach speechend stop auf und nimmt das Endergebnis", async (t) => {
    const { one, promise, states } = setup(t);
    one.fire("audiostart");
    one.fire("speechstart");
    one.result("the bus leaves at night");
    one.fire("speechend");
    assert.deepEqual(one.calls, ["start", "stop"]);
    assert.equal(states.at(-1), "finishing");
    one.result("the bus leaves at nine", true);
    one.fire("end");
    const result = await promise;
    assert.equal(result.status, "heard");
    assert.equal(result.transcript, "the bus leaves at nine");
    assert.deepEqual(one.calls, ["start", "stop"]);
  });

  it("ruft stop nur einmal auf, auch wenn Pause und speechend zusammenkommen", (t) => {
    const { one, tick } = setup(t);
    one.fire("audiostart");
    one.result("the bus");
    tick(1500);
    one.fire("speechend");
    one.result("the bus leaves");
    tick(100);
    assert.equal(one.calls.filter((call) => call === "stop").length, 1);
  });

  it("behält den Text, wenn das Endergebnis leer ist", async (t) => {
    const { one, promise } = setup(t);
    one.fire("audiostart");
    one.result("the bus leaves");
    one.fire("speechend");
    one.result("", true);
    one.fire("end");
    assert.equal((await promise).transcript, "the bus leaves");
  });

  it("verbindet mehrere Abschnitte mit einem Leerzeichen", async (t) => {
    const { one, promise } = setup(t);
    one.fire("audiostart");
    one.fire("result", {
      results: [
        Object.assign([{ transcript: "The bus leaves. " }], { isFinal: true }),
        Object.assign([{ transcript: "It is late." }], { isFinal: false }),
      ],
    });
    one.fire("end");
    assert.equal((await promise).transcript, "The bus leaves. It is late.");
  });

  it("wertet end ohne stop mit Text als gehört", async (t) => {
    const { one, promise } = setup(t);
    one.fire("audiostart");
    one.result("the bus leaves", true);
    one.fire("end");
    const result = await promise;
    assert.equal(result.status, "heard");
    assert.equal(result.reason, null);
  });

  it("nennt den passenden Grund bei end ohne Text", async (t) => {
    const noAudio = setup(t);
    noAudio.one.fire("end");
    assert.equal((await noAudio.promise).reason, "noAudioStart");
  });

  it("nennt noSpeech bei end nach audiostart ohne Sprache", async (t) => {
    const { one, promise } = setup(t);
    one.fire("audiostart");
    one.fire("end");
    assert.equal((await promise).reason, "noSpeech");
  });

  it("nennt noResult, wenn Sprache kam, aber kein Text", async (t) => {
    const { one, promise } = setup(t);
    one.fire("audiostart");
    one.fire("speechstart");
    one.fire("speechend");
    one.fire("end");
    const result = await promise;
    assert.equal(result.status, "notMeasured");
    assert.equal(result.reason, "noResult");
  });

  it("wertet doppelte end-Ereignisse und spätere Ergebnisse nicht", async (t) => {
    const { one, tick, promise } = setup(t);
    let settledCount = 0;
    promise.then(() => {
      settledCount += 1;
    });
    one.fire("audiostart");
    one.result("the bus");
    one.fire("end");
    one.fire("end");
    one.result("something later", true);
    one.fire("error", { error: "aborted" });
    const result = await promise;
    assert.equal(settledCount, 1);
    assert.equal(result.status, "heard");
    assert.equal(result.transcript, "the bus");
    tick(60000);
    assert.deepEqual(one.calls, ["start"]);
  });

  it("räumt alle Zeitgeber ab: nach dem Ergebnis ruft nichts mehr stop oder abort", async (t) => {
    const { one, tick, promise } = setup(t);
    one.fire("audiostart");
    one.fire("error", { error: "audio-capture" });
    await promise;
    tick(60000);
    assert.deepEqual(one.calls, ["start"]);
  });

  it("trägt die Ereignisse mit Zeit ein", async (t) => {
    const { one, tick, promise } = setup(t);
    tick(300);
    one.fire("audiostart");
    tick(1000);
    one.fire("end");
    const { events } = await promise;
    assert.deepEqual(events.find((event) => event.name === "audiostart"), { name: "audiostart", ms: 300 });
    assert.deepEqual(events.at(-1), { name: "end", ms: 1300 });
  });
});

describe("Spracherkennung: Zeitgrenze und Abbruch", () => {
  it("bricht ohne audiostart an der Zeitgrenze ab", async (t) => {
    const { one, tick, promise } = setup(t);
    tick(19999);
    assert.deepEqual(one.calls, ["start"]);
    tick(1);
    assert.deepEqual(one.calls, ["start", "abort"]);
    assert.equal((await promise).reason, "noAudioStart");
  });

  it("nennt noSpeech, wenn audiostart so spät kam, dass die Zeitgrenze zuerst greift", async (t) => {
    const { one, tick, promise } = setup(t);
    tick(16000);
    one.fire("audiostart");
    tick(4000);
    assert.equal((await promise).reason, "noSpeech");
  });

  it("beendet langes Sprechen an der Zeitgrenze mit stop und wertet den Text", async (t) => {
    const { one, tick, promise } = setup(t);
    one.fire("audiostart");
    one.fire("speechstart");
    for (let second = 1; second <= 19; second += 1) {
      tick(1000);
      one.result("word " + second);
    }
    tick(1000);
    assert.equal(one.calls.includes("stop"), true);
    one.fire("end");
    const result = await promise;
    assert.equal(result.status, "heard");
    assert.equal(result.transcript, "word 19");
  });

  it("wartet nach Sprache ohne Text an der Zeitgrenze noch auf das Endergebnis", async (t) => {
    const { one, tick, promise } = setup(t);
    one.fire("audiostart");
    one.fire("speechstart");
    tick(20000);
    assert.deepEqual(one.calls, ["start", "stop"]);
    tick(3000);
    const result = await promise;
    assert.equal(result.status, "notMeasured");
    assert.equal(result.reason, "noResult");
  });

  it("beendet den Lauf mit cancel", async (t) => {
    const { recognizer, one, promise } = setup(t);
    one.fire("audiostart");
    recognizer.cancel();
    const result = await promise;
    assert.equal(result.status, "notMeasured");
    assert.equal(result.reason, "cancelled");
    assert.deepEqual(one.calls, ["start", "abort"]);
  });

  it("cancel ohne laufenden Lauf tut nichts", () => {
    const { FakeRecognition } = fakeClass();
    assert.doesNotThrow(() => createRecognizer(FakeRecognition).cancel());
  });

  it("ein neuer Lauf beendet den alten", async (t) => {
    const { recognizer, one, promise, instances } = setup(t);
    const second = recognizer.listen({ lang: "en-GB" });
    assert.equal((await promise).reason, "cancelled");
    assert.deepEqual(one.calls, ["start", "abort"]);
    instances[1].fire("end");
    assert.equal((await second).status, "notMeasured");
  });
});
