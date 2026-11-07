import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

import { loadContent } from "../js/core/content.js";
import { focusUnits } from "../js/core/planner.js";
import { isLearned as isLearnedInCore } from "../js/core/srs.js";
import { createState, setUnitState, unitState } from "../js/core/state.js";
import { createRouter, parseRoute, routeHash } from "../js/ui/router.js";
import { backupReminderDue, dueCount, isFirstStart, openPlacement, waitingText } from "../js/ui/views/home.js";
import { buildStrands, isLearned, learnedCount, learnedText, nextEntry, nextHash, parseScenarioId, practicedCount, scenarioId } from "../js/ui/views/path.js";
import { fittingReactions, hasClinicNote, resolveSection } from "../js/ui/views/section.js";

const KNOWN_ROUTES = [
  "#/",
  "#/pfad",
  "#/abschnitt/x",
  "#/bahn",
  "#/bahn/x",
  "#/sprechen",
  "#/sprechen/x",
  "#/partner",
  "#/partner/a/b",
  "#/fortschritt",
  "#/einstufung",
  "#/sichern",
  "#/einstellungen",
];

describe("parseRoute", () => {
  const cases = [
    ["", "home", {}],
    ["#", "home", {}],
    ["#/", "home", {}],
    ["#/pfad", "path", {}],
    ["#/pfad/", "path", {}],
    ["#/abschnitt/sb.questions", "section", { id: "sb.questions" }],
    ["#/abschnitt/mri%3Asafety", "section", { id: "mri:safety" }],
    ["#/bahn", "train", {}],
    ["#/bahn/mri", "train", { focus: "mri" }],
    ["#/bahn/mri%3Asafety", "train", { focus: "mri:safety" }],
    ["#/sprechen", "speak", {}],
    ["#/sprechen/mr.safety", "speak", { focus: "mr.safety" }],
    ["#/sprechen/mri%3Asafety", "speak", { focus: "mri:safety" }],
    ["#/partner", "partner", {}],
    ["#/partner/fa.mri.1/patient", "partner", { caseId: "fa.mri.1", role: "patient" }],
    ["#/fortschritt", "progress", {}],
    ["#/einstufung", "placement", {}],
    ["#/sichern", "backup", {}],
    ["#/einstellungen", "settings", {}],
  ];

  for (const [hash, name, params] of cases) {
    it("erkennt " + (hash || "die leere Adresse"), () => {
      const route = parseRoute(hash);
      assert.equal(route.name, name);
      assert.deepEqual(route.params, params);
    });
  }

  it("kennt eine fremde Route nicht", () => {
    assert.equal(parseRoute("#/gibt-es-nicht").name, "unknown");
    assert.equal(parseRoute("#/abschnitt").name, "unknown");
    assert.equal(parseRoute("#/partner/nur-ein-teil").name, "unknown");
  });

  it("übersteht eine kaputte Kodierung", () => {
    assert.deepEqual(parseRoute("#/abschnitt/%E0%A4%A").params, { id: "%E0%A4%A" });
  });

  it("keine bekannte Route gilt als später", async () => {
    for (const hash of KNOWN_ROUTES) {
      const route = parseRoute(hash);
      assert.notEqual(route.later, true, hash);
      assert.notEqual(route.name, "unknown", hash);
      await access(new URL("../js/ui/views/" + route.view + ".js", import.meta.url));
    }
    assert.equal(parseRoute("#/gibt-es-nicht").view, null, "nur die unbekannte Route hat keine Ansicht");
  });

  it("nennt für Zurück ein festes Ziel, die Startseite hat keins", () => {
    assert.equal(parseRoute("#/").parent, null);
    assert.equal(parseRoute("#/pfad").parent, "#/");
    assert.equal(parseRoute("#/abschnitt/x").parent, "#/pfad");
    assert.equal(parseRoute("#/partner/a/b").parent, "#/partner");
    assert.equal(parseRoute("#/bahn/x").parent, "#/");
  });
});

describe("routeHash", () => {
  it("baut die Route und kodiert die Teile", () => {
    assert.equal(routeHash(), "#/");
    assert.equal(routeHash("pfad"), "#/pfad");
    assert.equal(routeHash("abschnitt", "mri:safety"), "#/abschnitt/mri%3Asafety");
    assert.deepEqual(parseRoute(routeHash("abschnitt", "mri:safety")).params, { id: "mri:safety" });
  });
});

// Ein Verlauf wie im Browser, nur als Daten. Neues Ziel: neuer Eintrag ohne state, wie beim Setzen von location.hash.
function createWin(startHash = "") {
  const listeners = {};
  const entries = [{ hash: startHash, state: null }];
  let index = 0;
  const win = {
    scrollY: 0,
    scrollTo(x, y) {
      win.scrollY = y;
    },
    location: {
      get hash() {
        return entries[index].hash;
      },
      set hash(value) {
        entries.splice(index + 1);
        entries.push({ hash: value, state: null });
        index += 1;
        win.fire("hashchange");
      },
    },
    history: {
      scrollRestoration: "auto",
      get state() {
        return entries[index].state;
      },
      get length() {
        return entries.length;
      },
      // Wie im Browser: ändert den Eintrag samt Adresse und löst kein hashchange aus.
      replaceState(state, title, url) {
        entries[index].state = state;
        if (url !== undefined) {
          entries[index].hash = url;
        }
      },
      back() {
        if (index > 0) {
          index -= 1;
          win.fire("hashchange");
        }
      },
    },
    addEventListener(type, listener) {
      (listeners[type] ??= []).push(listener);
    },
    removeEventListener(type, listener) {
      listeners[type] = (listeners[type] ?? []).filter((item) => item !== listener);
    },
    fire(type) {
      for (const listener of listeners[type] ?? []) {
        listener();
      }
    },
  };
  return win;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function setUp({ hash = "", views = {}, win = createWin(hash), importView } = {}) {
  const log = [];
  const errors = [];
  const soon = [];
  const backs = [];
  let cancels = 0;
  const allViews = {
    home: { render: (host, ctx, params) => void log.push(["home", params]) },
    path: { render: (host, ctx, params) => void log.push(["path", params]) },
    section: { render: (host, ctx, params) => void log.push(["section", params]) },
    settings: { render: (host, ctx, params) => void log.push(["settings", params]) },
    ...views,
  };
  const container = {
    host: null,
    replaceChildren(host) {
      this.host = host;
    },
  };
  const ctx = {
    tts: {
      cancel() {
        cancels += 1;
      },
    },
  };
  const router = createRouter({
    container,
    ctx,
    win,
    onError: (error) => errors.push(error),
    importView:
      importView ??
      (async (name) => {
        if (!allViews[name]) {
          throw new TypeError("Importing a module script failed.");
        }
        return allViews[name];
      }),
    createHost: () => ({ kind: "host" }),
    ensureBack: (host) => backs.push(host),
    comingSoon: (host, givenCtx, detail) => soon.push(detail),
  });
  return { router, win, log, errors, soon, backs, container, cancels: () => cancels };
}

describe("createRouter", () => {
  it("zeigt beim Start die Startseite und setzt die Tiefe", async () => {
    const { router, win, log, backs } = setUp();
    await router.start();
    assert.deepEqual(log, [["home", {}]]);
    assert.deepEqual(win.history.state, { depth: 0 });
    assert.equal(win.history.scrollRestoration, "manual");
    assert.deepEqual(backs, [], "die Startseite hat keinen Zurück-Knopf");
  });

  it("gibt die Parameter weiter und setzt Zurück ein, wenn die Ansicht keinen hat", async () => {
    const { router, log, backs } = setUp({ hash: "#/abschnitt/kl.repeat" });
    await router.start();
    assert.deepEqual(log, [["section", { id: "kl.repeat" }]]);
    assert.equal(backs.length, 1);
  });

  it("jede Ansicht bekommt einen neuen Behälter", async () => {
    const { router, container, win } = setUp();
    await router.start();
    const first = container.host;
    win.location.hash = "#/pfad";
    await flush();
    assert.notEqual(container.host, first);
  });

  it("räumt die alte Ansicht beim Wechsel auf und stoppt den Ton", async () => {
    const cleaned = [];
    const { router, win, cancels } = setUp({
      views: { path: { render: () => () => cleaned.push("path") } },
    });
    await router.start();
    const before = cancels();
    win.location.hash = "#/pfad";
    await flush();
    assert.deepEqual(cleaned, []);
    win.location.hash = "#/";
    await flush();
    assert.deepEqual(cleaned, ["path"]);
    assert.equal(cancels(), before + 2);
  });

  it("navigate setzt die Adresse, dasselbe Ziel zeichnet neu", async () => {
    const { router, win, log } = setUp();
    await router.start();
    router.navigate("#/pfad");
    await flush();
    assert.equal(win.location.hash, "#/pfad");
    router.navigate("#/pfad");
    await flush();
    assert.deepEqual(log.map(([name]) => name), ["home", "path", "path"]);
  });

  it("navigate mit replace: Der laufende Schritt verlässt den Verlauf, Zurück führt davor", async () => {
    const { router, win, log } = setUp();
    await router.start();
    router.navigate("#/einstellungen");
    await flush();
    router.navigate("#/pfad", { replace: true });
    await flush();
    assert.equal(win.location.hash, "#/pfad");
    assert.deepEqual(log.map(([name]) => name), ["home", "settings", "path"]);
    router.back();
    await flush();
    assert.equal(win.location.hash, "");
    assert.equal(log.at(-1)[0], "home");
    assert.equal(win.history.length, 2);
  });

  it("die leere Adresse und #/ sind dasselbe Ziel", async () => {
    const { router, win, log } = setUp();
    await router.start();
    router.navigate("#/");
    await flush();
    assert.equal(win.location.hash, "");
    assert.deepEqual(log.map(([name]) => name), ["home", "home"]);
  });

  it("fehlt die Datei einer Ansicht, kommt die Fehlerkarte statt „Kommt noch“", async () => {
    const { router, errors, soon, backs } = setUp({ hash: "#/bahn/mri" });
    await router.start();
    assert.equal(errors.length, 1);
    assert.equal(errors[0].name, "TypeError");
    assert.deepEqual(soon, []);
    assert.deepEqual(backs, []);
  });

  it("nur eine unbekannte Route zeigt „Kommt noch“, ohne Technikzeile", async () => {
    const { router, errors, soon } = setUp({ hash: "#/gibt-es-nicht" });
    await router.start();
    assert.deepEqual(errors, []);
    assert.deepEqual(soon, [undefined]);
  });

  it("fehlt die Startseite, ist das ein Fehler", async () => {
    const { router, errors, soon } = setUp({ importView: async () => { throw new TypeError("weg"); } });
    await router.start();
    assert.equal(errors.length, 1);
    assert.deepEqual(soon, []);
  });

  it("ein Syntaxfehler in einer Ansicht ist ein Fehler", async () => {
    const { router, errors, soon } = setUp({
      hash: "#/bahn",
      importView: async () => {
        throw new SyntaxError("Unexpected token");
      },
    });
    await router.start();
    assert.equal(errors[0].name, "SyntaxError");
    assert.deepEqual(soon, []);
  });

  it("wirft eine Ansicht beim Laden etwas anderes, ist das ein Fehler", async () => {
    const { router, errors, soon } = setUp({
      hash: "#/bahn",
      importView: async () => {
        throw new ReferenceError("planTrain is not defined");
      },
    });
    await router.start();
    assert.equal(errors[0].name, "ReferenceError");
    assert.deepEqual(soon, []);
  });

  it("bei jeder bekannten Route ist ein Ladefehler echt, etwa wenn etwas fehlt, das die Ansicht braucht", async () => {
    for (const hash of KNOWN_ROUTES) {
      const { router, errors, soon } = setUp({
        hash,
        importView: async () => {
          throw new TypeError("Importing a module script failed.");
        },
      });
      await router.start();
      assert.equal(errors.length, 1, hash);
      assert.deepEqual(soon, [], hash);
    }
  });

  it("ein überholter Ladefehler bleibt ohne Folgen", async () => {
    let failLoad = null;
    const drawn = [];
    const { router, win, errors, soon } = setUp({
      hash: "#/bahn",
      importView: (name) =>
        name === "train"
          ? new Promise((resolve, reject) => {
              failLoad = () => reject(new TypeError("weg"));
            })
          : Promise.resolve({ render: () => void drawn.push(name) }),
    });
    const started = router.start();
    await flush();
    win.location.hash = "#/pfad";
    await flush();
    failLoad();
    await started;
    await flush();
    assert.deepEqual(errors, []);
    assert.deepEqual(soon, []);
    assert.deepEqual(drawn, ["path"]);
  });

  it("ein Fehler beim Zeichnen geht an onError", async () => {
    const { router, errors } = setUp({
      views: {
        home: {
          render() {
            throw new Error("kaputt");
          },
        },
      },
    });
    await router.start();
    assert.equal(errors[0].message, "kaputt");
  });

  it("eine überholte Ansicht wird gar nicht erst gezeichnet", async () => {
    let releaseSlow = null;
    const drawn = [];
    const { router, win } = setUp({
      importView: (name) => {
        if (name === "path") {
          return new Promise((resolve) => {
            releaseSlow = () => resolve({ render: () => void drawn.push("path") });
          });
        }
        return Promise.resolve({ render: () => void drawn.push(name) });
      },
    });
    await router.start();
    win.location.hash = "#/pfad";
    win.location.hash = "#/sichern";
    await flush();
    releaseSlow();
    await flush();
    assert.deepEqual(drawn, ["home", "backup"]);
  });

  it("eine Ansicht, die nach dem Verlassen fertig wird, räumt sofort auf", async () => {
    let finishRender = null;
    const cleaned = [];
    const { router, win } = setUp({
      views: {
        path: {
          render: () =>
            new Promise((resolve) => {
              finishRender = () => resolve(() => cleaned.push("path"));
            }),
        },
      },
    });
    await router.start();
    win.location.hash = "#/pfad";
    await flush();
    win.location.hash = "#/";
    await flush();
    finishRender();
    await flush();
    assert.deepEqual(cleaned, ["path"]);
  });

  it("stop hört nicht mehr auf die Adresse", async () => {
    const { router, win, log } = setUp();
    await router.start();
    router.stop();
    win.location.hash = "#/pfad";
    await flush();
    assert.deepEqual(log.map(([name]) => name), ["home"]);
  });
});

describe("Zurück", () => {
  it("geht einen Schritt im Verlauf zurück, wenn es einen gibt", async () => {
    const { router, win, log } = setUp();
    await router.start();
    win.location.hash = "#/pfad";
    await flush();
    win.location.hash = "#/abschnitt/kl.repeat";
    await flush();
    router.back();
    await flush();
    assert.equal(win.location.hash, "#/pfad");
    router.back();
    await flush();
    assert.equal(win.location.hash, "");
    assert.deepEqual(log.map(([name]) => name), ["home", "path", "section", "path", "home"]);
  });

  it("ohne früheren Schritt gilt das feste Ziel der Route", async () => {
    const { router, win } = setUp({ hash: "#/abschnitt/kl.repeat" });
    await router.start();
    router.back();
    await flush();
    assert.equal(win.location.hash, "#/pfad");
  });

  it("sonst führt es zur Startseite", async () => {
    const { router, win } = setUp({ hash: "#/einstellungen" });
    await router.start();
    router.back();
    await flush();
    assert.equal(win.location.hash, "#/");
  });

  it("Start im Abschnitt: Zweimal Zurück führt zur Startseite, nicht im Kreis", async () => {
    const { router, win, log, backs } = setUp({ hash: "#/abschnitt/kl.repeat" });
    await router.start();
    router.back();
    await flush();
    assert.equal(win.location.hash, "#/pfad");
    router.back();
    await flush();
    assert.equal(win.location.hash, "#/");
    assert.deepEqual(log.map(([name]) => name), ["section", "path", "home"]);
    assert.equal(win.history.length, 1, "kein neuer Eintrag im Verlauf");
    assert.deepEqual(win.history.state, { depth: 0 });
    assert.equal(backs.length, 2, "die Startseite hat keinen Zurück-Knopf");
  });

  it("Start in der Partner-Rolle: Über die Partner-Seite zur Startseite", async () => {
    const seen = [];
    const { router, win } = setUp({
      hash: "#/partner/fa.mri.1/patient",
      views: { partner: { render: () => void seen.push(win.location.hash) }, home: { render: () => void seen.push("home") } },
    });
    await router.start();
    router.back();
    await flush();
    router.back();
    await flush();
    assert.deepEqual(seen, ["#/partner/fa.mri.1/patient", "#/partner", "home"]);
  });

  it("Nach dem Ersetzen führt ein neuer Schritt und Zurück wieder hierher, mit der alten Scrollposition", async () => {
    const { router, win } = setUp({ hash: "#/abschnitt/kl.repeat" });
    await router.start();
    router.back();
    await flush();
    assert.equal(win.location.hash, "#/pfad");
    win.scrollY = 300;
    win.location.hash = "#/abschnitt/kl.spell";
    await flush();
    assert.deepEqual(win.history.state, { depth: 1 });
    router.back();
    await flush();
    assert.equal(win.location.hash, "#/pfad");
    assert.equal(win.scrollY, 300);
    assert.deepEqual(win.history.state, { depth: 0 });
  });

  it("Der Ersatz räumt die alte Ansicht auf und stoppt den Ton", async () => {
    const cleaned = [];
    const { router, cancels } = setUp({
      hash: "#/abschnitt/kl.repeat",
      views: { section: { render: () => () => cleaned.push("section") } },
    });
    await router.start();
    const before = cancels();
    router.back();
    await flush();
    assert.deepEqual(cleaned, ["section"]);
    assert.equal(cancels(), before + 1);
  });

  it("nach dem Neuladen bleibt die Tiefe erhalten", async () => {
    const first = setUp();
    await first.router.start();
    first.win.location.hash = "#/pfad";
    await flush();
    first.router.stop();
    // Dasselbe Fenster, also derselbe Verlauf, aber ein neuer Router wie nach location.reload().
    const second = setUp({ win: first.win });
    await second.router.start();
    assert.deepEqual(second.log, [["path", {}]]);
    second.router.back();
    await flush();
    assert.equal(first.win.location.hash, "");
  });

  it("stellt die Scrollposition beim Zurückkommen wieder her", async () => {
    const { router, win } = setUp();
    await router.start();
    win.location.hash = "#/pfad";
    await flush();
    win.scrollY = 640;
    win.location.hash = "#/abschnitt/kl.repeat";
    await flush();
    assert.equal(win.scrollY, 0);
    router.back();
    await flush();
    assert.equal(win.scrollY, 640);
  });
});

const NOW = new Date("2026-11-07T12:00:00Z");
const freshState = () => createState(new Date("2026-11-01T12:00:00Z"));

describe("Startseite", () => {
  it("erkennt den ersten Start", () => {
    const state = freshState();
    assert.equal(isFirstStart(state), true);
    assert.equal(isFirstStart({ ...state, placement: { attempts: [], plan: null, skippedAt: NOW.toISOString() } }), false);
    assert.equal(isFirstStart({ ...state, placement: { attempts: [{}], plan: null } }), false);
    const practiced = freshState();
    setUnitState(practiced, "x", unitState(practiced, "x"));
    assert.equal(isFirstStart(practiced), false);
  });

  it("zählt fällige Einheiten ohne Inhaltsdaten", () => {
    const state = freshState();
    state.units = {
      today: { due: "2026-11-07" },
      earlier: { due: "2026-11-01" },
      later: { due: "2026-11-08" },
      none: { due: null },
    };
    assert.equal(dueCount(state, "2026-11-07"), 2);
  });
});

describe("Startseite: offener Einstufungstest und Texte", () => {
  const storeWith = (session) => ({
    loadSession: () => session,
  });

  it("findet nur einen Test dieser Version", () => {
    const session = { kind: "placement", appVersion: "1" };
    assert.equal(openPlacement(storeWith(session), "1"), session);
    assert.equal(openPlacement(storeWith(session), "2"), null);
    assert.equal(openPlacement(storeWith({ kind: "speech", appVersion: "1" }), "1"), null);
    assert.equal(openPlacement(storeWith(null), "1"), null);
  });

  it("ein Speicher, der wirft, nimmt nur die Karte weg", () => {
    const broken = {
      loadSession() {
        throw new Error("Speicher nicht lesbar");
      },
    };
    assert.equal(openPlacement(broken, "1"), null);
  });

  it("dieselbe Sache heißt überall gleich", () => {
    assert.equal(waitingText(1), "1 Satz oder Wort wartet auf dich.");
    assert.equal(waitingText(24), "24 Sätze und Wörter warten auf dich.");
  });

  it("die Route für den Partner führt in die Ansicht Partner", () => {
    const route = parseRoute(routeHash("partner", "alle", "patient"));
    assert.equal(route.view, "partner");
    assert.deepEqual(route.params, { caseId: "alle", role: "patient" });
  });
});

describe("Lernpfad: geübt und gelernt", () => {
  const content = {
    unit: (id) => ({ s1: { type: "sentence" }, s2: { type: "sentence" }, w1: { type: "word" } })[id] ?? null,
  };

  it("zählt, was schon geübt ist, Gelerntes immer mit", () => {
    const state = createState(new Date("2026-11-07T08:00:00.000Z"));
    state.units = {
      s1: { box: 3, seen: 4, spokenB: false },
      s2: { box: 0, seen: 0, due: "2026-11-07" },
      w1: { box: 2, seen: 0 },
    };
    assert.equal(learnedCount(["s1", "s2", "w1"], content, state), 1);
    assert.equal(practicedCount(["s1", "s2", "w1", "gibt-es-nicht"], content, state), 2);
  });

  it("die zweite Zahl steht nur da, wenn sie etwas sagt", () => {
    assert.equal(learnedText(0, 6, 6), "0 von 6 gelernt, 6 geübt");
    assert.equal(learnedText(2, 6, 2), "2 von 6 gelernt");
    assert.equal(learnedText(0, 6, 0), "0 von 6 gelernt");
  });

  it("nextHash führt in den nächsten Abschnitt, ist alles gelernt, in den Lernpfad", () => {
    const full = {
      sections: () => [{ id: "sb.one", titleDe: "Eins", strand: "grammar", file: "satzbau", unitIds: ["s1"] }],
      examSections: () => [],
      unit: () => ({ type: "sentence", sectionId: "sb.one" }),
    };
    const state = createState(new Date("2026-11-07T08:00:00.000Z"));
    assert.equal(nextHash(full, state), "#/abschnitt/sb.one");
    state.units.s1 = { spokenB: true };
    assert.equal(nextHash(full, state), "#/pfad");
  });
});

describe("Sicherungs-Erinnerung", () => {
  function practiced(lastAt) {
    const state = freshState();
    state.units.x = { ...unitState(state, "x"), lastAt };
    return state;
  }

  it("schweigt, wenn nichts geübt wurde", () => {
    assert.equal(backupReminderDue(freshState(), "2026-12-01"), false);
  });

  it("ohne Sicherung zählt der Tag des Anlegens", () => {
    const state = practiced("2026-11-02T12:00:00.000Z");
    assert.equal(backupReminderDue(state, "2026-11-07"), false, "erst 6 Tage");
    assert.equal(backupReminderDue(state, "2026-11-08"), true, "7 Tage");
  });

  it("nach einer Sicherung zählt nur, was danach geübt wurde", () => {
    const state = practiced("2026-11-02T12:00:00.000Z");
    state.backup.lastAt = "2026-11-03T12:00:00.000Z";
    assert.equal(backupReminderDue(state, "2026-11-20"), false);
    state.units.x.lastAt = "2026-11-05T12:00:00.000Z";
    assert.equal(backupReminderDue(state, "2026-11-09"), false, "erst 6 Tage her");
    assert.equal(backupReminderDue(state, "2026-11-10"), true);
  });

  it("Übungstage in der Statistik zählen auch", () => {
    const state = freshState();
    state.backup.lastAt = "2026-11-03T12:00:00.000Z";
    state.stats.days["2026-11-03"] = { exercises: 5 };
    assert.equal(backupReminderDue(state, "2026-11-20"), false, "derselbe Tag ist nicht seither");
    state.stats.days["2026-11-04"] = { exercises: 0 };
    assert.equal(backupReminderDue(state, "2026-11-20"), false, "nichts geübt");
    state.stats.days["2026-11-05"] = { exercises: 3 };
    assert.equal(backupReminderDue(state, "2026-11-20"), true);
  });

  it("ein kaputtes Datum löst keinen Fehler aus", () => {
    const state = practiced("2026-11-02T12:00:00.000Z");
    state.backup.lastAt = "kein Datum";
    assert.equal(backupReminderDue(state, "2026-11-20"), false);
  });
});

describe("Lernpfad und Abschnitt mit den echten Daten", () => {
  const dataDir = new URL("../daten/", import.meta.url);
  const contentPromise = loadContent(async (name) => JSON.parse(await readFile(new URL(name + ".json", dataDir), "utf8")));

  it("gelernt: Satz nur mit spokenB, Patientenäußerung und Wort ab Box 2", () => {
    assert.equal(isLearned, isLearnedInCore, "der Lernpfad reicht die Regel aus core/srs.js nur weiter");
    assert.equal(isLearned({ type: "sentence" }, { box: 5, spokenB: false }), false);
    assert.equal(isLearned({ type: "sentence" }, { box: 0, spokenB: true }), true);
    assert.equal(isLearned({ type: "patient" }, { box: 1 }), false);
    assert.equal(isLearned({ type: "patient" }, { box: 2 }), true);
    assert.equal(isLearned({ type: "word" }, { box: 2 }), true);
  });

  it("zwei Stränge mit den vorgesehenen Gruppen", async () => {
    const strands = buildStrands(await contentPromise);
    assert.deepEqual(strands.map((strand) => strand.titleDe), ["Satzbau", "Fachsprache"]);
    assert.deepEqual(strands[0].groups.map((group) => group.titleDe), ["Grammatik", "Small Talk", "Klären"]);
    assert.deepEqual(strands[1].groups.map((group) => group.titleDe), ["MRT", "CT", "Röntgen"]);
    for (const group of strands.flatMap((strand) => strand.groups)) {
      assert.ok(group.entries.length > 0, group.titleDe);
    }
  });

  it("Small Talk steht ohne Vorsilbe im Titel, Grammatik ohne Small Talk", async () => {
    const [satzbau] = buildStrands(await contentPromise);
    const [grammar, smallTalk] = satzbau.groups;
    assert.ok(grammar.entries.every((entry) => !entry.titleDe.includes("Small Talk")));
    assert.ok(smallTalk.entries.every((entry) => !entry.titleDe.startsWith("Small Talk")));
    assert.ok(smallTalk.entries.every((entry) => entry.id.startsWith("sb.")));
  });

  it("jeder Eintrag des Lernpfads führt zu einem Abschnitt mit gültigem Fokus", async () => {
    const content = await contentPromise;
    for (const group of buildStrands(content).flatMap((strand) => strand.groups)) {
      for (const entry of group.entries) {
        const section = resolveSection(content, parseRoute(routeHash("abschnitt", entry.id)).params.id);
        assert.ok(section, entry.id);
        assert.deepEqual(section.unitIds, entry.unitIds);
        assert.ok(section.unitIds.length > 0, entry.id);
        assert.ok(section.unitIds.every((id) => content.unit(id) !== null), entry.id);
        assert.equal(section.focus, entry.id);
        assert.deepEqual(focusUnits(content, section.focus).map((unit) => unit.id), section.unitIds, "geübt wird, was der Abschnitt zeigt: " + entry.id);
      }
    }
  });

  it("Szenario: Der Fokus ist das ganze Szenario", async () => {
    const content = await contentPromise;
    assert.equal(resolveSection(content, scenarioId("mri", "noise")).focus, "mri:noise");
    assert.equal(resolveSection(content, scenarioId("mri", "greeting")).focus, "mri:greeting");
    assert.equal(resolveSection(content, scenarioId("ct", "safety")).focus, "ct:safety");
  });

  it("ct.safety und ct:safety sind verschieden: der Abschnitt und das Szenario", async () => {
    const content = await contentPromise;
    const section = resolveSection(content, "ct.safety");
    const scenario = resolveSection(content, "ct:safety");
    assert.equal(parseScenarioId("ct.safety"), null);
    assert.deepEqual(parseScenarioId("ct:safety"), { exam: "ct", key: "safety" });
    assert.ok(scenario.unitIds.length > section.unitIds.length);
    assert.ok(scenario.titleDe.startsWith("CT: "));
  });

  it("die Grammatik bringt ihre Erklärung und deren Quelle mit", async () => {
    const content = await contentPromise;
    const section = resolveSection(content, "sb.questions");
    assert.ok(section.explanationDe);
    assert.ok(content.source(section.explanationSource).url);
  });

  it("unbekannte Abschnitte und Szenarien ergeben null", async () => {
    const content = await contentPromise;
    assert.equal(resolveSection(content, "sb.gibt-es-nicht"), null);
    assert.equal(resolveSection(content, "mri:gibt-es-nicht"), null);
    assert.equal(parseScenarioId("xx:safety"), null);
  });

  it("der nächste Abschnitt ist der erste mit offenen Einheiten, samt Gruppe", async () => {
    const content = await contentPromise;
    const strands = buildStrands(content);
    const state = freshState();
    const first = nextEntry(strands, content, state);
    assert.equal(first.groupId, "grammar");
    assert.equal(first.id, strands[0].groups[0].entries[0].id);

    for (const id of first.unitIds) {
      setUnitState(state, id, { ...unitState(state, id), spokenB: true });
    }
    const second = nextEntry(strands, content, state);
    assert.equal(second.id, strands[0].groups[0].entries[1].id);

    for (const unit of content.allUnits()) {
      setUnitState(state, unit.id, { ...unitState(state, unit.id), spokenB: true, box: 2 });
    }
    assert.equal(nextEntry(strands, content, state), null);
  });

  it("jede Patientenäußerung hat genau eine passende Reaktion mit Satz und Quelle", async () => {
    const content = await contentPromise;
    const patients = content.allUnits().filter((unit) => unit.type === "patient");
    assert.ok(patients.length > 0);
    for (const unit of patients) {
      const fitting = fittingReactions(unit);
      assert.equal(fitting.length, 1, unit.id);
      assert.ok(fitting[0].en, unit.id);
      assert.ok(content.source(fitting[0].source), unit.id);
    }
  });

  it("der Klinik-Hinweis zählt an der Einheit und an der passenden Reaktion, nicht an einer falschen", () => {
    const unit = (extra) => ({ clinicDependent: false, reactions: [], ...extra });
    assert.equal(hasClinicNote([unit()]), false);
    assert.equal(hasClinicNote([unit(), unit({ clinicDependent: true })]), true);
    assert.equal(hasClinicNote([unit({ reactions: [{ fits: true, clinicDependent: true }] })]), true);
    assert.equal(hasClinicNote([unit({ reactions: [{ fits: false, clinicDependent: true }] })]), false);
  });

  it("ein Szenario zeigt die Erklärung seines Abschnitts, die eigene zuerst", () => {
    const shared = { id: "ge.safety", key: "safety", file: "gemeinsam", exam: null, explanationDe: "gemeinsam erklärt", explanationSource: "q1" };
    const own = { id: "mr.safety", key: "safety", file: "mrt", exam: "mri", explanationDe: null, explanationSource: null };
    const content = {
      sections: () => [shared, own],
      examSections: () => [{ key: "safety", titleDe: "Sicherheit", unitIds: [] }],
    };
    assert.equal(resolveSection(content, "mri:safety").explanationDe, "gemeinsam erklärt");
    assert.equal(resolveSection(content, "mri:safety").explanationSource, "q1");
    own.explanationDe = "eigen erklärt";
    own.explanationSource = "q2";
    assert.equal(resolveSection(content, "mri:safety").explanationDe, "eigen erklärt");
    assert.equal(resolveSection(content, "mri:safety").explanationSource, "q2");
    assert.equal(resolveSection(content, "mri:safety").focus, "mri:safety");
  });

  it("zählt gelernte Einheiten eines Abschnitts", async () => {
    const content = await contentPromise;
    const unitIds = content.sections().find((section) => section.id === "mr.safety").unitIds;
    const sentence = unitIds.find((id) => content.unit(id).type === "sentence");
    const patient = unitIds.find((id) => content.unit(id).type === "patient");
    const state = freshState();
    assert.equal(learnedCount(unitIds, content, state), 0);
    setUnitState(state, sentence, { ...unitState(state, sentence), box: 5 });
    assert.equal(learnedCount(unitIds, content, state), 0, "hohe Box reicht beim Satz nicht");
    setUnitState(state, sentence, { ...unitState(state, sentence), spokenB: true });
    setUnitState(state, patient, { ...unitState(state, patient), box: 2 });
    assert.equal(learnedCount(unitIds, content, state), 2);
    assert.equal(learnedCount(["id.gibt-es-nicht"], content, state), 0);
  });
});

describe("Der nächste Abschnitt nach dem Lernplan", () => {
  const units = {
    "a.1": { type: "patient", sectionId: "sec.a" },
    "b.1": { type: "patient", sectionId: "sec.b" },
    "b.2": { type: "patient", sectionId: "sec.c" },
    "c.1": { type: "patient", sectionId: "sec.z" },
    "d.1": { type: "patient", sectionId: "sec.z" },
    "e.1": { type: "patient", sectionId: "sec.e" },
  };
  const content = { unit: (id) => units[id] ?? null };
  const strands = [
    {
      titleDe: "Eins",
      groups: [
        {
          id: "first",
          titleDe: "Erste",
          entries: [
            { id: "entry.a", titleDe: "A", unitIds: ["a.1"] },
            { id: "entry.b", titleDe: "B", unitIds: ["b.1", "b.2"] },
          ],
        },
      ],
    },
    {
      titleDe: "Zwei",
      groups: [
        {
          id: "second",
          titleDe: "Zweite",
          entries: [
            { id: "entry.c", titleDe: "C", unitIds: ["c.1"] },
            { id: "entry.d", titleDe: "D", unitIds: ["d.1"] },
            { id: "entry.e", titleDe: "E", unitIds: ["e.1"] },
          ],
        },
      ],
    },
  ];

  function stateWithPlan(order, learned = []) {
    const state = freshState();
    state.placement.plan = { order, noteDe: "" };
    for (const id of learned) {
      setUnitState(state, id, { ...unitState(state, id), box: 2 });
    }
    return state;
  }

  // Alle Einträge in der Reihenfolge, in der sie drankommen: Jeder gefundene gilt danach als gelernt.
  function walk(state) {
    const seen = [];
    for (let next = nextEntry(strands, content, state); next; next = nextEntry(strands, content, state)) {
      seen.push(next.id);
      for (const id of next.unitIds) {
        setUnitState(state, id, { ...unitState(state, id), box: 2 });
      }
    }
    return seen;
  }

  it("ohne Plan gilt die Reihenfolge des Lernpfads", () => {
    assert.deepEqual(walk(freshState()), ["entry.a", "entry.b", "entry.c", "entry.d", "entry.e"]);
  });

  it("der Plan bestimmt den Eintrag und bringt seine Gruppe mit", () => {
    const next = nextEntry(strands, content, stateWithPlan(["sec.e", "sec.a"]));
    assert.equal(next.id, "entry.e");
    assert.equal(next.groupId, "second");
    assert.deepEqual(next.unitIds, ["e.1"]);
  });

  it("es zählt der kleinste Rang der Einheiten eines Eintrags", () => {
    assert.deepEqual(walk(stateWithPlan(["sec.c", "sec.a", "sec.b", "sec.e", "sec.z"])), ["entry.b", "entry.a", "entry.e", "entry.c", "entry.d"]);
  });

  it("bei gleichem Rang bleibt die Reihenfolge", () => {
    assert.deepEqual(walk(stateWithPlan(["sec.z"])).slice(0, 2), ["entry.c", "entry.d"]);
  });

  it("was der Plan nicht nennt, kommt ans Ende, in der Reihenfolge des Lernpfads", () => {
    assert.deepEqual(walk(stateWithPlan(["sec.e", "sec.c"])), ["entry.e", "entry.b", "entry.a", "entry.c", "entry.d"]);
  });

  it("Gelerntes wird auch nach Plan übersprungen, ist alles gelernt: null", () => {
    assert.equal(nextEntry(strands, content, stateWithPlan(["sec.e", "sec.a"], ["e.1"])).id, "entry.a");
    assert.equal(nextEntry(strands, content, stateWithPlan(["sec.e"], Object.keys(units))), null);
  });

  it("eine unbekannte Einheit und unbekannte Abschnitte im Plan stören nicht", () => {
    const withUnknown = [
      { titleDe: "Eins", groups: [{ id: "first", titleDe: "Erste", entries: [{ id: "entry.x", titleDe: "X", unitIds: ["gibt-es-nicht", "a.1"] }, { id: "entry.e", titleDe: "E", unitIds: ["e.1"] }] }] },
    ];
    assert.equal(nextEntry(withUnknown, content, stateWithPlan(["sec.alt", "sec.e", "sec.a"])).id, "entry.e");
  });

  it("ein leerer oder kaputter Plan ändert die Reihenfolge nicht", () => {
    assert.equal(nextEntry(strands, content, stateWithPlan([])).id, "entry.a");
    assert.equal(nextEntry(strands, content, stateWithPlan("kaputt")).id, "entry.a");
    const noPlan = freshState();
    noPlan.placement.plan = null;
    assert.equal(nextEntry(strands, content, noPlan).id, "entry.a");
  });
});
