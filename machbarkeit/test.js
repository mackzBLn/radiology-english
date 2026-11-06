"use strict";

/*
 * Radiology English – Machbarkeitstest: Logik der Testseite.
 * Klassisches Skript ohne import und export, damit node --check es prüfen kann (Syntaxprüfung ohne Ausführung [N1]).
 * Bezeichner englisch, Kommentare deutsch, Oberfläche deutsch.
 *
 * Quellen: "Quelle N" verweist auf die Quellenlisten des Projekts. Die Adressen [N1] und [M1] bis [M61]
 * wurden am 03.11.2026 gelesen (Node-Doku, MDN Web Docs, [M23] WebKit-Quellcode), [M62] bis [M74] am 06.11.2026
 * (MDN Web Docs, [M66] bis [M68] WebKit-Quellcode, Hauptzweig; das ausgelieferte iOS kann abweichen).
 * [M10], [M11], [M29], [M30], [M34] und [M53] sowie Quelle 29 wurden am 06.11.2026 erneut gelesen.
 *  [N1]  https://nodejs.org/api/cli.html (Option -c, --check)
 *  [M1]  https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognitionErrorEvent/error
 *  [M2]  https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognitionErrorEvent/message
 *  [M3]  https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition
 *  [M4]  https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/continuous
 *  [M5]  https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/interimResults
 *  [M6]  https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/maxAlternatives
 *  [M7]  https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognitionEvent/resultIndex
 *  [M8]  https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognitionResult/isFinal
 *  [M9]  https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognitionAlternative/confidence
 *  [M10] https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/getVoices
 *  [M11] https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/voiceschanged_event
 *  [M12] https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisVoice
 *  [M13] https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisUtterance
 *  [M14] https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisUtterance/rate
 *  [M15] https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/speak
 *  [M16] https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/cancel
 *  [M17] https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/speaking
 *  [M18] https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/pending
 *  [M19] https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisErrorEvent/error
 *  [M20] https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event
 *  [M21] https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilityState
 *  [M22] https://developer.mozilla.org/en-US/docs/Web/API/Navigator/userAgent
 *  [M23] https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/page/Navigator.idl
 *  [M24] https://developer.mozilla.org/en-US/docs/Web/CSS/@media/display-mode
 *  [M25] https://developer.mozilla.org/en-US/docs/Web/API/Window/matchMedia
 *  [M26] https://developer.mozilla.org/en-US/docs/Web/API/Window/isSecureContext
 *  [M27] https://developer.mozilla.org/en-US/docs/Web/API/Navigator/onLine
 *  [M28] https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/controller
 *  [M29] https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register
 *  [M30] https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/update
 *  [M31] https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/waiting
 *  [M32] https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/installing
 *  [M33] https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/updatefound_event
 *  [M34] https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorker/state
 *  [M35] https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorker/postMessage
 *  [M36] https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/controllerchange_event
 *  [M37] https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage
 *  [M38] https://developer.mozilla.org/en-US/docs/Web/API/Window/indexedDB
 *  [M39] https://developer.mozilla.org/en-US/docs/Web/API/IDBFactory/open
 *  [M40] https://developer.mozilla.org/en-US/docs/Web/API/IDBOpenDBRequest/upgradeneeded_event
 *  [M41] https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/transaction
 *  [M42] https://developer.mozilla.org/en-US/docs/Web/API/IDBObjectStore/put
 *  [M43] https://developer.mozilla.org/en-US/docs/Web/API/IDBObjectStore/get
 *  [M44] https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction
 *  [M45] https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persisted
 *  [M46] https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist
 *  [M47] https://developer.mozilla.org/en-US/docs/Web/API/Blob/Blob
 *  [M48] https://developer.mozilla.org/en-US/docs/Web/API/File/File
 *  [M49] https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL_static
 *  [M50] https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/a
 *  [M51] https://developer.mozilla.org/en-US/docs/Web/API/Navigator/canShare
 *  [M52] https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share
 *  [M53] https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/file
 *  [M54] https://developer.mozilla.org/en-US/docs/Web/API/Blob/text
 *  [M55] https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse
 *  [M56] https://developer.mozilla.org/en-US/docs/Web/API/Window/confirm
 *  [M57] https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/length
 *  [M58] https://developer.mozilla.org/en-US/docs/Web/API/HTMLTextAreaElement/select
 *  [M59] https://developer.mozilla.org/en-US/docs/Web/API/HTMLTextAreaElement/setSelectionRange
 *  [M60] https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toISOString
 *  [M61] https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toLocaleTimeString
 *  [M62] https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout
 *  [M63] https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisUtterance/start_event
 *  [M64] https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisUtterance/end_event
 *  [M65] https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisUtterance/error_event
 *  [M66] https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/Modules/speech/SpeechSynthesis.cpp
 *  [M67] https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/Modules/speech/SpeechSynthesis.h
 *  [M68] https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/page/DOMTimer.cpp
 *  [M69] https://developer.mozilla.org/en-US/docs/Web/API/Blob/type
 *  [M70] https://developer.mozilla.org/en-US/docs/Web/API/Blob/size
 *  [M71] https://developer.mozilla.org/en-US/docs/Web/API/File/name
 *  [M72] https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorker/statechange_event
 *  [M73] https://developer.mozilla.org/en-US/docs/Web/API/Client/postMessage
 *  [M74] https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/startMessages
 */

// Version der Seite. Der Service Worker (sw.js) trägt dieselbe Konstante; weichen beide ab, zeigt die Seite das an.
// sw.js sucht beim Installieren in der gecachten Datei nach genau dieser Schreibweise, darum die Zeile nicht umformatieren.
const VERSION = "0.1.2";

(function () {
  // ---------- Festwerte ----------

  // Speicher gehört zum Ursprung der Seite (Quelle 39); Testseite und App liegen unter demselben Ursprung (Quelle 11).
  // Darum tragen alle Schlüssel und Datenbanknamen diese Vorsilbe.
  const STORAGE_PREFIX = "radiology-english.machbarkeit.";
  const LOCAL_KEY = STORAGE_PREFIX + "counter";
  const DB_NAME = STORAGE_PREFIX + "store";
  const DB_VERSION = 1;
  const STORE_NAME = "values";
  const COUNTER_KEY = "counter";

  const BACKUP_FORMAT = "radiology-english.machbarkeit";
  const BACKUP_FORMAT_VERSION = 1;

  const RECOGNITION_TIMEOUT_MS = 15000;
  const RECOGNITION_START_TIMEOUT_MS = 45000;
  const SW_VERSION_TIMEOUT_MS = 3000;
  const EXERCISE_START_TIMEOUT_MS = 8000;
  const OBJECT_URL_RELEASE_MS = 60000;
  // „Zweiter Satz verzögert“: Pause nach dem Ende von Satz 1 und längste Wartezeit auf das start-Ereignis von Satz 2.
  const DELAYED_GAP_MS = 2000;
  const DELAYED_START_TIMEOUT_MS = 8000;

  // Die beiden Dateifelder zum Einlesen; die Bezeichnung erscheint in Status und Ergebnis.
  const IMPORT_FIELDS = [
    { id: "import-file", label: "Feld „Einlesen (JSON-Datei)“, mit accept" },
    { id: "import-file-any", label: "Feld „Einlesen, alle Dateien“, ohne accept" }
  ];

  // Anlass, die Stimmenliste zu laden, mit Bezeichnung für Anzeige und Ergebnis.
  const VOICE_LOAD_LABELS = {
    open: "beim Öffnen",
    changed: "nach voiceschanged",
    tap: "nach dem Tipp auf „Stimmen neu laden“"
  };

  // Neutrale Alltagssätze ohne Fachinhalt; sie brauchen keine Quelle (Vorgabe des Projekts).
  const SENTENCES = {
    recognition: "The weather is nice today and the park is open.",
    single: "The weather is nice today and the park is open.",
    two: ["The weather is nice today.", "We are going to the park after lunch."],
    delayed: ["This is the first sentence.", "And this is the second sentence."],
    long: [
      "The weather is nice today.",
      "We are going to the park after lunch.",
      "The bus leaves at nine in the morning.",
      "My brother likes to read books in the evening.",
      "The shop closes at six o'clock."
    ],
    exercise: "The shop closes at six in the evening."
  };
  const EXERCISE_CORRECT_INDEX = 1;

  // Fehlercodes der Spracherkennung mit deutscher Erklärung, Liste nach [M1].
  const RECOGNITION_ERRORS = {
    "aborted": "Die Spracheingabe wurde abgebrochen, etwa durch die Seite oder das System.",
    "audio-capture": "Die Tonaufnahme ist fehlgeschlagen (Mikrofon).",
    "bad-grammar": "Fehler in der Grammatik; dieser Code steht nicht mehr in der Spezifikation.",
    "language-not-supported": "Der Browser unterstützt die Sprache aus lang nicht.",
    "network": "Die für die Erkennung nötige Netzverbindung ist fehlgeschlagen.",
    "no-speech": "Es wurde keine Sprache erkannt.",
    "not-allowed": "Der Browser hat die Spracheingabe nicht erlaubt (Sicherheit, Datenschutz oder Einstellung).",
    "phrases-not-supported": "Das Erkennungsmodell unterstützt keine Phrasen zur Gewichtung.",
    "service-not-allowed": "Der Browser hat den gewünschten Erkennungsdienst nicht erlaubt."
  };

  // Fehlercodes der Sprachausgabe mit deutscher Erklärung, Liste nach [M19].
  const SYNTHESIS_ERRORS = {
    "canceled": "Durch cancel() aus der Warteschlange entfernt, bevor gesprochen wurde.",
    "interrupted": "Durch cancel() während des Sprechens abgebrochen.",
    "audio-busy": "Das Audiogerät ist belegt, etwa durch eine andere App.",
    "audio-hardware": "Kein Audiogerät gefunden.",
    "network": "Eine nötige Netzverbindung ist fehlgeschlagen.",
    "synthesis-unavailable": "Keine Sprachausgabe verfügbar.",
    "synthesis-failed": "Die Sprachausgabe hat einen Fehler gemeldet.",
    "language-unavailable": "Keine passende Stimme für die Sprache der Äußerung.",
    "voice-unavailable": "Die gewählte Stimme ist nicht verfügbar.",
    "text-too-long": "Der Text ist zu lang.",
    "invalid-argument": "rate, pitch oder volume ist ungültig.",
    "not-allowed": "Der Start war nicht erlaubt."
  };

  // ---------- Zustand und Ergebnis ----------

  const state = {
    recognition: null,
    recognitionRun: null,    // zuletzt gestarteter Lauf; nur er schreibt in die Felder der Karte
    voices: [],
    voiceHistory: { atOpen: null, changed: [], reloads: [], firstFilled: null },
    selectedVoiceKey: null,
    utterances: [],          // Verweise auf laufende Äußerungen; ob das nötig ist, ist offen.
    delayedRun: null,        // laufender Test „Zweiter Satz verzögert“
    exercise: null,
    counter: 0,
    registration: null,
    swVersion: undefined,    // undefined: keine Antwort, null: kein steuernder Service Worker, sonst Versionstext
    swVersionNote: "",
    versionTimer: 0,
    updateReady: false,
    updateRequested: false,
    reloading: false,
    watchedWorkers: new Set(),  // neue Service Worker, deren Zustand die Seite schon beobachtet
    installFailureDetail: ""    // Fehlertext aus der Meldung des Service Workers
  };

  const report = {
    openedAt: new Date(),
    env: [],                 // [Bezeichnung, Wert]
    apis: [],                // [Bezeichnung, "ja" oder "nein", Klasse]
    pageEvents: [],
    recognitionRuns: [],     // alle Erkennungsläufe in der Reihenfolge des Starts; nichts wird überschrieben
    voices: [],
    delayedRuns: [],         // alle Läufe von „Zweiter Satz verzögert“
    tts: [],
    exercise: [],
    storage: { local: "…", db: "…", persisted: "…", persist: "noch nicht angefragt", log: [] },
    imports: [],             // erfolgreiches Einlesen mit Feld, Uhrzeit und Zähler
    backup: [],
    keyboard: [],
    swChecks: [],            // Meldungen des Service Workers zu seiner Installation
    updateNotice: "",        // Hinweis auf der Seite, wenn Registrierung oder Installation fehlschlägt
    update: []
  };

  // ---------- Hilfsfunktionen ----------

  function $(id) {
    return document.getElementById(id);
  }

  // Ortszeit mit Millisekunden; toLocaleTimeString formatiert nach der Sprache de-DE [M61].
  function timeStamp() {
    const now = new Date();
    return now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) +
      "," + String(now.getMilliseconds()).padStart(3, "0");
  }

  function setStatus(element, text, level) {
    element.textContent = text;
    element.classList.remove("ok", "warn", "err");
    if (level) {
      element.classList.add(level);
    }
  }

  function describeError(error) {
    if (!error) {
      return "unbekannter Fehler";
    }
    return (error.name || "Error") + " – " + (error.message || String(error));
  }

  function fillTable(table, rows) {
    table.textContent = "";
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.textContent = row[0];
      const td = document.createElement("td");
      td.textContent = row[1];
      if (row[2]) {
        td.classList.add(row[2]);
      }
      tr.appendChild(th);
      tr.appendChild(td);
      table.appendChild(tr);
    });
  }

  function pushAll(lines, items) {
    if (!items.length) {
      lines.push("–");
      return;
    }
    items.forEach((item) => lines.push(item));
  }

  // ---------- 10. Ergebnis ----------

  function renderReport() {
    const lines = [];
    lines.push("Radiology English – Machbarkeitstest");
    lines.push("Seite: " + VERSION);
    lines.push("Service Worker: " + swVersionText());
    // toISOString liefert die Zeit in UTC [M60].
    lines.push("Geöffnet: " + report.openedAt.toISOString() + " (UTC), Ortszeit " +
      report.openedAt.toLocaleTimeString("de-DE"));
    lines.push("");
    lines.push("[Umgebung]");
    report.env.forEach((row) => lines.push(row[0] + ": " + row[1]));
    report.pageEvents.forEach((line) => lines.push(line));
    lines.push("");
    lines.push("[Schnittstellen]");
    report.apis.forEach((row) => lines.push(row[0] + ": " + row[1]));
    ["en-GB", "en-US"].forEach((lang) => {
      lines.push("");
      lines.push("[Spracherkennung " + lang + "]");
      recognitionLines(lang).forEach((line) => lines.push(line));
    });
    lines.push("");
    lines.push("[Stimmen]");
    voiceHistoryLines().forEach((line) => lines.push(line));
    pushAll(lines, report.voices);
    lines.push("");
    lines.push("[Sprachausgabe]");
    delayedRunLines().forEach((line) => lines.push(line));
    pushAll(lines, report.tts);
    lines.push("");
    lines.push("[Übung ohne Netz]");
    pushAll(lines, report.exercise);
    lines.push("");
    lines.push("[Speichern]");
    lines.push("localStorage: " + report.storage.local);
    lines.push("IndexedDB: " + report.storage.db);
    lines.push("persisted(): " + report.storage.persisted);
    lines.push("persist(): " + report.storage.persist);
    report.storage.log.forEach((line) => lines.push(line));
    lines.push("");
    lines.push("[Sichern und Einlesen]");
    importLines().forEach((line) => lines.push(line));
    pushAll(lines, report.backup);
    lines.push("");
    lines.push("[Tastatur]");
    pushAll(lines, report.keyboard);
    lines.push("");
    lines.push("[Aktualisierung]");
    serviceWorkerCheckLines().forEach((line) => lines.push(line));
    pushAll(lines, report.update);
    $("report").value = lines.join("\n");
  }

  function selectReport() {
    const area = $("report");
    area.focus();
    // select() markiert den ganzen Text [M58]; setSelectionRange zusätzlich [M59]. Ob iOS beides braucht, ist offen.
    area.select();
    try {
      area.setSelectionRange(0, area.value.length);
    } catch (error) {
      // unerheblich, select() ist schon gelaufen
    }
  }

  // ---------- 2. Umgebung ----------

  function controllerText() {
    if (!("serviceWorker" in navigator)) {
      return "nein (kein serviceWorker)";
    }
    // controller ist der steuernde Service Worker oder null [M28].
    return navigator.serviceWorker.controller ? "ja" : "nein";
  }

  function collectEnvironment() {
    // navigator.standalone ist eine WebKit-eigene Eigenschaft [M23]; display-mode: standalone ist der Standardweg [M24], abgefragt per matchMedia [M25].
    const standalone = typeof navigator.standalone === "boolean" ? String(navigator.standalone) : "nicht vorhanden";
    const displayMode = typeof window.matchMedia === "function"
      ? String(window.matchMedia("(display-mode: standalone)").matches)
      : "matchMedia fehlt";
    report.env = [
      ["userAgent", navigator.userAgent],                       // [M22]
      ["navigator.standalone", standalone],
      ["display-mode standalone", displayMode],
      ["isSecureContext", String(window.isSecureContext)],     // [M26]
      ["navigator.onLine", String(navigator.onLine)],          // [M27]
      ["Service Worker steuert die Seite", controllerText()]
    ];
    fillTable($("env-table"), report.env);
  }

  function updateEnvironmentRow(label, value) {
    const row = report.env.find((item) => item[0] === label);
    if (row) {
      row[1] = value;
    }
    fillTable($("env-table"), report.env);
    renderReport();
  }

  // Der Zugriff auf localStorage kann eine SecurityError-Ausnahme werfen [M37], darum try/catch.
  function hasLocalStorage() {
    try {
      return window.localStorage !== undefined && window.localStorage !== null;
    } catch (error) {
      return false;
    }
  }

  function detectApis() {
    const checks = [
      ["webkitSpeechRecognition", "webkitSpeechRecognition" in window],
      ["SpeechRecognition", "SpeechRecognition" in window],
      ["speechSynthesis", "speechSynthesis" in window],
      ["serviceWorker", "serviceWorker" in navigator],
      ["localStorage", hasLocalStorage()],
      ["indexedDB", "indexedDB" in window && window.indexedDB !== null],   // [M38]
      ["navigator.storage.persist", Boolean(navigator.storage && typeof navigator.storage.persist === "function")],
      ["navigator.share", typeof navigator.share === "function"],
      ["navigator.canShare", typeof navigator.canShare === "function"]
    ];
    report.apis = checks.map((check) => [check[0], check[1] ? "ja" : "nein", check[1] ? "ok" : "err"]);
    fillTable($("api-table"), report.apis);
  }

  function watchNetwork() {
    // Bei einem Wechsel feuert online oder offline auf window; der Wert gilt nur als Hinweis [M27].
    ["online", "offline"].forEach((type) => {
      window.addEventListener(type, () => {
        report.pageEvents.push(timeStamp() + " " + type + ": navigator.onLine = " + navigator.onLine);
        updateEnvironmentRow("navigator.onLine", String(navigator.onLine) + " (geändert " + timeStamp() + ")");
      });
    });
  }

  function watchVisibility() {
    // visibilitychange feuert u. a. beim Wechsel zu einer anderen App und bei aktiver Bildschirmsperre [M20, M21].
    document.addEventListener("visibilitychange", () => {
      logTts("Seite " + (document.visibilityState === "hidden" ? "verborgen" : "sichtbar") +
        " (visibilityState " + document.visibilityState + ")");
    });
  }

  // ---------- 3. Spracherkennung ----------

  function explainRecognitionError(code) {
    return RECOGNITION_ERRORS[code] || "Code nicht in der MDN-Liste [M1]";
  }

  function formatConfidence(value) {
    return typeof value === "number" ? value.toFixed(3) : String(value);
  }

  function setRecognitionButtons(enabled) {
    $("btn-rec-gb").disabled = !enabled;
    $("btn-rec-us").disabled = !enabled;
  }

  function renderFinalResult(run) {
    if (!run.finals.length) {
      return;
    }
    const lines = [];
    run.finals.forEach((alternatives, i) => {
      lines.push("Endergebnis " + (i + 1) + ":");
      alternatives.forEach((alternative, j) => {
        lines.push("  " + (j + 1) + ". " + alternative.transcript +
          " (confidence " + formatConfidence(alternative.confidence) + ")");
      });
    });
    $("rec-final").textContent = lines.join("\n");
  }

  function recognitionRunsFor(lang) {
    return report.recognitionRuns.filter((run) => run.lang === lang);
  }

  // Kurzfassung eines Laufs: Endergebnis oder Fehlercode.
  function recognitionOutcome(run) {
    if (run.unsupported) {
      return "Schnittstelle fehlt";
    }
    const parts = [];
    if (run.finals.length) {
      parts.push("Endergebnis " + run.finals.map((alternatives) => (alternatives.length
        ? "\"" + alternatives[0].transcript + "\" (confidence " + formatConfidence(alternatives[0].confidence) + ")"
        : "(ohne Alternative)")).join(", "));
    }
    if (run.error) {
      parts.push("Fehlercode " + run.error.code);
    }
    if (run.exception) {
      parts.push("Ausnahme " + run.exception.name);
    }
    if (run.timedOut) {
      parts.push("Abbruch nach " + (RECOGNITION_TIMEOUT_MS / 1000) + " s");
    }
    if (parts.length) {
      return parts.join(", ");
    }
    return run.ended ? "kein Endergebnis, kein Fehlercode" : "läuft";
  }

  function renderRecognitionRuns() {
    $("rec-runs").textContent = report.recognitionRuns.length
      ? report.recognitionRuns.map((run) => run.lang + ", Lauf " + run.number + ", " + run.startedAt + ": " +
        recognitionOutcome(run)).join("\n")
      : "–";
  }

  function recognitionLines(lang) {
    const runs = recognitionRunsFor(lang);
    if (!runs.length) {
      return ["nicht gestartet"];
    }
    const lines = [
      "Einstellungen: lang=" + lang + ", continuous=false, interimResults=true, maxAlternatives=3",
      "Läufe: " + runs.length
    ];
    runs.forEach((run) => {
      lines.push(lang + ", Lauf " + run.number + ", gestartet " + run.startedAt + ": " + recognitionOutcome(run));
      recognitionRunDetails(run).forEach((line) => lines.push("  " + line));
    });
    return lines;
  }

  function recognitionRunDetails(run) {
    const lines = [];
    if (run.unsupported) {
      lines.push("Schnittstelle fehlt: " + run.unsupported);
      return lines;
    }
    if (run.exception) {
      lines.push("Ausnahme: " + run.exception.name + " – " + run.exception.message);
    }
    if (run.finals.length) {
      run.finals.forEach((alternatives, i) => {
        lines.push("Endergebnis " + (i + 1) + ":");
        alternatives.forEach((alternative, j) => {
          lines.push("  " + (j + 1) + ". \"" + alternative.transcript + "\" (confidence " +
            formatConfidence(alternative.confidence) + ")");
        });
      });
    } else {
      lines.push("Endergebnis: keines" +
        (run.lastInterim ? ", letztes Zwischenergebnis: \"" + run.lastInterim + "\"" : ""));
    }
    if (run.error) {
      lines.push("Fehler: " + run.error.code + " – " + explainRecognitionError(run.error.code) +
        (run.error.message ? " [" + run.error.message + "]" : ""));
    }
    if (run.timedOut) {
      lines.push("Abbruch durch die Seite nach " + (RECOGNITION_TIMEOUT_MS / 1000) + " s ohne end-Ereignis");
    }
    lines.push("Ereignisse:");
    run.events.forEach((event) => lines.push("  " + event));
    return lines;
  }

  function startRecognition(lang) {
    const status = $("rec-status");
    // Safari bietet die Schnittstelle als webkitSpeechRecognition an (Quelle 27).
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const run = {
      lang: lang,
      number: recognitionRunsFor(lang).length + 1,   // laufende Nummer je Sprache
      startedAt: timeStamp(),
      events: [],
      finals: [],
      lastInterim: "",
      error: null,
      exception: null,
      timedOut: false,
      unsupported: null,
      ended: false
    };
    // Jeder Lauf kommt als eigener Eintrag in die Liste; ein neuer Lauf überschreibt keinen alten.
    report.recognitionRuns.push(run);
    state.recognitionRun = run;
    $("rec-interim").textContent = "–";
    $("rec-final").textContent = "–";
    $("rec-events").textContent = "–";

    if (!Recognition) {
      run.unsupported = "weder SpeechRecognition noch webkitSpeechRecognition vorhanden";
      setStatus(status, "Spracherkennung nicht vorhanden: " + run.unsupported, "err");
      renderRecognitionRuns();
      renderReport();
      return;
    }
    if (state.recognition) {
      try {
        state.recognition.abort();
      } catch (error) {
        // alter Lauf, Fehler unerheblich
      }
      state.recognition = null;
    }

    let recognition;
    try {
      recognition = new Recognition();
    } catch (error) {
      run.exception = { name: error.name, message: error.message };
      setStatus(status, "Ausnahme beim Anlegen: " + describeError(error), "err");
      renderRecognitionRuns();
      renderReport();
      return;
    }

    // Einstellungen, die Safari kennt (Quelle 27): lang, continuous [M4], interimResults [M5], maxAlternatives [M6].
    recognition.lang = lang;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;
    state.recognition = recognition;
    setRecognitionButtons(false);

    // Späte Ereignisse eines älteren Laufs landen in dessen Eintrag, aber nicht in den Feldern des neuen Laufs.
    function isLatestRun() {
      return state.recognitionRun === run;
    }

    function addEvent(text) {
      run.events.push(timeStamp() + " " + text);
      if (isLatestRun()) {
        $("rec-events").textContent = run.events.join("\n");
      }
      renderRecognitionRuns();
      renderReport();
    }

    function finish() {
      if (state.recognition === recognition) {
        state.recognition = null;
      }
      if (isLatestRun()) {
        setRecognitionButtons(true);
        if (!run.error && !run.exception && !run.timedOut) {
          setStatus(status, "Beendet (" + lang + ", Lauf " + run.number + ")" + (run.finals.length ? "" : ", kein Endergebnis"),
            run.finals.length ? "ok" : "warn");
        }
      }
      renderRecognitionRuns();
      renderReport();
    }

    // Ereignisse der Schnittstelle [M3].
    ["start", "audiostart", "soundstart", "speechstart", "speechend", "soundend", "audioend", "nomatch"].forEach((type) => {
      recognition.addEventListener(type, () => addEvent(type));
    });

    recognition.addEventListener("result", (event) => {
      addEvent("result (resultIndex " + event.resultIndex + ", Ergebnisse " + event.results.length + ")");
      // Ab resultIndex haben sich Ergebnisse geändert [M7]; isFinal trennt End- von Zwischenergebnissen [M8].
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) {
          const alternatives = [];
          for (let j = 0; j < result.length; j += 1) {
            // confidence: Schätzung zwischen 0 und 1 [M9].
            alternatives.push({ transcript: result[j].transcript, confidence: result[j].confidence });
          }
          run.finals.push(alternatives);
        } else {
          interim += result[0].transcript;
        }
      }
      if (interim) {
        run.lastInterim = interim;
      }
      if (isLatestRun()) {
        if (interim) {
          $("rec-interim").textContent = interim;
        }
        renderFinalResult(run);
      }
      renderRecognitionRuns();
      renderReport();
    });

    recognition.addEventListener("error", (event) => {
      // Fehlercodes nach [M1], Meldung nach [M2] (Wortlaut je Browser).
      run.error = { code: event.error, message: event.message || "" };
      addEvent("error " + event.error);
      if (isLatestRun()) {
        setStatus(status, "Fehler " + event.error + " – " + explainRecognitionError(event.error) +
          (event.message ? " [" + event.message + "]" : ""), "err");
      }
    });

    recognition.addEventListener("end", () => {
      run.ended = true;
      clearTimeout(timer);
      addEvent("end");
      finish();
    });

    // Das Zeitlimit zählt ab audiostart, davor kann noch eine Abfrage des Systems offen sein
    // (Testprotokoll in Entscheidungen.md, Lauf 1: 6,4 s bis start). Kommt kein audiostart, gilt das längere Limit.
    function onTimeout() {
      if (run.ended) {
        return;
      }
      run.timedOut = true;
      addEvent("Abbruch durch die Seite: " + (RECOGNITION_TIMEOUT_MS / 1000) + " s ohne end-Ereignis, abort() aufgerufen");
      if (isLatestRun()) {
        setStatus(status, "Abbruch nach " + (RECOGNITION_TIMEOUT_MS / 1000) + " Sekunden ohne Ende", "err");
      }
      try {
        recognition.abort();
      } catch (error) {
        addEvent("abort() Ausnahme: " + describeError(error));
      }
      finish();
    }

    let timer = setTimeout(onTimeout, RECOGNITION_START_TIMEOUT_MS);
    recognition.addEventListener("audiostart", () => {
      clearTimeout(timer);
      timer = setTimeout(onTimeout, RECOGNITION_TIMEOUT_MS);
    });

    try {
      recognition.start();
      addEvent("start() aufgerufen, lang=" + lang);
      setStatus(status, "Läuft (" + lang + ", Lauf " + run.number + "), bitte jetzt den Satz sprechen.", "warn");
    } catch (error) {
      run.exception = { name: error.name, message: error.message };
      clearTimeout(timer);
      addEvent("Ausnahme bei start(): " + describeError(error));
      setStatus(status, "Ausnahme beim Start: " + describeError(error), "err");
      finish();
    }
  }

  // ---------- 4. Sprachausgabe ----------

  function isEnglishVoice(voice) {
    // lang ist ein BCP-47-Tag [M12], etwa en-GB oder en-US.
    return /^en([-_]|$)/i.test(String(voice.lang));
  }

  function compareVoices(a, b) {
    const englishA = isEnglishVoice(a);
    const englishB = isEnglishVoice(b);
    if (englishA !== englishB) {
      return englishA ? -1 : 1;
    }
    return (a.lang + " " + a.name).localeCompare(b.lang + " " + b.name);
  }

  function voiceKey(voice) {
    return voice.lang + "|" + voice.name;
  }

  function describeVoice(voice) {
    // Eigenschaften name, lang, localService, default [M12].
    return voice.lang + ": " + voice.name + (voice.localService ? ", lokal" : ", entfernt") +
      (voice.default ? ", Standard" : "");
  }

  // Hält fest, wann die Liste wie viele Stimmen hatte: beim Öffnen, nach voiceschanged oder nach dem Tipp.
  // Dass die Liste beim Öffnen leer sein kann, steht in [M10] nicht; ob das unter iOS vorkommt, zeigt dieser Test.
  function noteVoiceLoad(source, count, when) {
    const history = state.voiceHistory;
    const firstFill = count > 0 && !history.firstFilled;
    if (firstFill) {
      history.firstFilled = { source: source, at: when };
    }
    if (source === "open") {
      history.atOpen = count;
      logTts("Stimmenliste beim Öffnen: " + (count ? "nicht leer, " + count + " Stimmen" : "leer"));
    } else if (source === "changed") {
      history.changed.push(when + " (" + count + " Stimmen)");
      logTts("voiceschanged: " + count + " Stimmen" + (firstFill ? ", Liste damit erstmals gefüllt" : ""));
    } else {
      history.reloads.push(when + " (" + count + " Stimmen)");
      logTts("Stimmen neu laden (Tipp): " + count + " Stimmen; beim Öffnen " + (history.atOpen ? "nicht leer" : "leer") +
        ", voiceschanged " + (history.changed.length ? history.changed.length + "-mal" : "nicht gekommen") +
        ", erst nach diesem Tipp gefüllt: " + (firstFill ? "ja" : "nein"));
    }
  }

  function voiceHistoryLines() {
    const history = state.voiceHistory;
    if (history.atOpen === null) {
      return [];   // Ohne speechSynthesis wurde nichts gemessen; das steht in report.voices.
    }
    const filled = history.firstFilled;
    let afterTap = "nein, Liste bisher leer";
    if (filled) {
      afterTap = filled.source === "tap"
        ? "ja (" + filled.at + ")"
        : "nein, gefüllt " + VOICE_LOAD_LABELS[filled.source] + (filled.source === "open" ? "" : " (" + filled.at + ")");
    }
    return [
      "Liste beim Öffnen: " + (history.atOpen ? "nicht leer, " + history.atOpen + " Stimmen" : "leer"),
      "voiceschanged gekommen: " + (history.changed.length ? "ja, " + history.changed.join(", ") : "nein"),
      "Stimmen neu laden getippt: " + (history.reloads.length ? "ja, " + history.reloads.join(", ") : "nein"),
      "Erst nach dem Tipp gefüllt: " + afterTap
    ];
  }

  function loadVoices(source) {
    const synth = window.speechSynthesis;
    if (!synth) {
      $("voice-summary").textContent = "speechSynthesis nicht vorhanden.";
      report.voices = ["speechSynthesis nicht vorhanden"];
      renderReport();
      return;
    }
    // getVoices() liefert die Stimmen des Geräts [M10]; ändert sich die Liste, feuert voiceschanged [M11].
    const voices = synth.getVoices().slice().sort(compareVoices);
    state.voices = voices;
    const english = voices.filter(isEnglishVoice);
    const when = timeStamp();
    noteVoiceLoad(source, voices.length, when);
    const summary = "Stimmen gesamt: " + voices.length + ", davon englisch: " + english.length +
      " (" + VOICE_LOAD_LABELS[source] + (source === "open" ? "" : ", " + when) + ")";
    $("voice-summary").textContent = summary;

    const table = document.createElement("table");
    const head = document.createElement("tr");
    ["Name", "Sprache", "lokal", "Standard"].forEach((label) => {
      const th = document.createElement("th");
      th.textContent = label;
      head.appendChild(th);
    });
    table.appendChild(head);
    voices.forEach((voice) => {
      const tr = document.createElement("tr");
      [voice.name, voice.lang, voice.localService ? "ja" : "nein", voice.default ? "ja" : "nein"].forEach((value) => {
        const td = document.createElement("td");
        td.textContent = value;
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });
    const list = $("voice-list");
    list.textContent = "";
    if (voices.length) {
      list.appendChild(table);
    } else {
      list.textContent = "Keine Stimmen gemeldet.";
    }

    const select = $("voice-select");
    select.textContent = "";
    select.appendChild(new Option("automatisch (lang en-GB, der Browser wählt)", ""));
    english.forEach((voice, index) => {
      select.appendChild(new Option(describeVoice(voice), String(index)));
    });
    let selectedIndex = -1;
    if (state.selectedVoiceKey) {
      selectedIndex = english.findIndex((voice) => voiceKey(voice) === state.selectedVoiceKey);
    }
    if (selectedIndex < 0 && english.length) {
      selectedIndex = 0;
    }
    select.value = selectedIndex >= 0 ? String(selectedIndex) : "";
    if (selectedIndex >= 0) {
      state.selectedVoiceKey = voiceKey(english[selectedIndex]);
    }

    report.voices = [summary].concat(english.map(describeVoice));
    if (voices.length > english.length) {
      report.voices.push("Weitere Stimmen (nicht englisch): " + (voices.length - english.length));
    }
    renderReport();
  }

  function selectedVoice() {
    const value = $("voice-select").value;
    if (value === "") {
      return null;
    }
    const english = state.voices.filter(isEnglishVoice);
    return english[Number(value)] || null;
  }

  function describeVoiceChoice(voice) {
    return voice ? voice.name + " (" + voice.lang + ")" : "automatisch (lang en-GB)";
  }

  function logTts(text) {
    report.tts.push(timeStamp() + " " + text);
    $("tts-log").textContent = report.tts.join("\n");
    renderReport();
  }

  function explainSynthesisError(code) {
    return SYNTHESIS_ERRORS[code] || "Code nicht in der MDN-Liste [M19]";
  }

  // Legt eine Äußerung an und protokolliert ihre Ereignisse mit Uhrzeit, error mit Code.
  function createUtterance(text, name, voice, rate) {
    const utterance = new SpeechSynthesisUtterance(text);
    // lang, voice, rate und die Ereignisse start, end, error, pause, resume [M13]; rate 0,1 bis 10, Standard 1 [M14].
    utterance.lang = voice ? voice.lang : "en-GB";
    if (voice) {
      utterance.voice = voice;
    }
    utterance.rate = rate;
    ["start", "end", "pause", "resume"].forEach((type) => {
      utterance.addEventListener(type, () => logTts(name + " " + type));
    });
    utterance.addEventListener("error", (event) => {
      logTts(name + " error " + event.error + " – " + explainSynthesisError(event.error));
    });
    state.utterances.push(utterance);
    return utterance;
  }

  function speakSentences(sentences, label, rate) {
    const synth = window.speechSynthesis;
    if (!synth) {
      logTts(label + ": speechSynthesis nicht vorhanden");
      return;
    }
    stopDelayedRun("andere Ausgabe gestartet");
    // Laufende oder wartende Äußerungen [M17, M18] vorher abbrechen [M16]; sie melden dann canceled oder interrupted [M19].
    if (synth.speaking || synth.pending) {
      synth.cancel();
      logTts("Warteschlange geleert (cancel), vorherige Äußerungen melden canceled oder interrupted");
    }
    const voice = selectedVoice();
    logTts(label + ": " + sentences.length + " Äußerung(en) werden eingereiht, Stimme " +
      describeVoiceChoice(voice) + ", rate " + rate + ", navigator.onLine " + navigator.onLine);
    sentences.forEach((text, index) => {
      const utterance = createUtterance(text, label + " " + (index + 1) + "/" + sentences.length, voice, rate);
      // speak() reiht ein; gesprochen wird nach den vorherigen Äußerungen [M15]. Ein Tipp, mehrere Sätze.
      synth.speak(utterance);
    });
  }

  // ---------- 4. Sprachausgabe: zweiter Satz verzögert ----------

  // Prüft, ob iOS eine Ausgabe außerhalb der Nutzeraktion erlaubt (Quelle 29): Ein Tipp startet Satz 1, Satz 2 startet die Seite selbst.
  // Im Hauptzweig von WebKit hebt ein speak() im Tipp die Sperre für diese Seite auf [M66, M67]; was das ausgelieferte iOS tut, ist offen und zeigt dieser Test.

  function showDelayedStatus(run, level) {
    setStatus($("tts-delayed-status"), "Zweiter Satz verzögert, Lauf " + run.number + ": " + run.result, level);
  }

  function updateDelayedRun(run, text) {
    if (run.done) {
      return;
    }
    run.result = text;
    showDelayedStatus(run);
    renderReport();
  }

  // Legt das Ergebnis eines Laufs endgültig fest; es steht im Protokoll und im Ergebnis.
  function finishDelayedRun(run, text, level) {
    if (run.done) {
      return;
    }
    run.done = true;
    run.result = text;
    clearTimeout(run.gapTimer);
    clearTimeout(run.startTimer);
    if (state.delayedRun === run) {
      state.delayedRun = null;
    }
    showDelayedStatus(run, level);
    logTts("Verzögert, Lauf " + run.number + ": " + text);
  }

  // Eine andere Ausgabe vor dem Start von Satz 2 würde das Ergebnis verfälschen, darum zählt der Lauf dann nicht.
  function stopDelayedRun(reason) {
    if (state.delayedRun) {
      finishDelayedRun(state.delayedRun, "abgebrochen, " + reason + ", Satz 2 nicht bewertet", "warn");
    }
  }

  function delayedRunLines() {
    if (!report.delayedRuns.length) {
      return ["Zweiter Satz verzögert: nicht getestet"];
    }
    return report.delayedRuns.map((run) => "Zweiter Satz verzögert, Lauf " + run.number + ", gestartet " + run.startedAt + ": " + run.result);
  }

  function startDelayedRun() {
    const synth = window.speechSynthesis;
    const run = {
      number: report.delayedRuns.length + 1,
      startedAt: timeStamp(),
      result: "läuft",
      done: false,
      gapTimer: 0,
      startTimer: 0
    };
    report.delayedRuns.push(run);
    if (!synth) {
      finishDelayedRun(run, "nicht möglich, speechSynthesis nicht vorhanden", "err");
      return;
    }
    stopDelayedRun("neuer Lauf gestartet");
    state.delayedRun = run;
    if (synth.speaking || synth.pending) {
      synth.cancel();
      logTts("Warteschlange geleert (cancel), vorherige Äußerungen melden canceled oder interrupted");
    }
    const voice = selectedVoice();
    logTts("Verzögert, Lauf " + run.number + ": Satz 1 wird im Tipp eingereiht, Stimme " + describeVoiceChoice(voice) +
      ", rate 1, navigator.onLine " + navigator.onLine);
    const first = createUtterance(SENTENCES.delayed[0], "Verzögert Satz 1", voice, 1);
    first.addEventListener("start", () => updateDelayedRun(run, "Satz 1 wird gesprochen"));
    first.addEventListener("end", () => {
      if (run.done) {
        return;
      }
      // end: Satz 1 ist fertig gesprochen [M64]. Erst jetzt startet der Zeitgeber [M62]. Ein Zeitgeber übernimmt nur eine
      // Nutzeraktion, die beim Anlegen läuft [M68]; hier ist der Tipp längst vorbei (Vorgabe des Projekts: außerhalb der Nutzeraktion).
      updateDelayedRun(run, "Satz 1 beendet, Satz 2 folgt in " + (DELAYED_GAP_MS / 1000) + " s ohne Tipp");
      run.gapTimer = setTimeout(() => speakSecondSentence(run, voice), DELAYED_GAP_MS);
    });
    first.addEventListener("error", (event) => {
      // error: Ein Fehler verhindert das Sprechen [M65]; Satz 2 entfällt, ein späteres end ändert daran nichts.
      finishDelayedRun(run, "Satz 2 nicht versucht, Satz 1 meldete error " + event.error + " – " + explainSynthesisError(event.error), "err");
    });
    updateDelayedRun(run, "Satz 1 eingereiht");
    synth.speak(first);
  }

  function speakSecondSentence(run, voice) {
    if (run.done) {
      return;
    }
    const synth = window.speechSynthesis;
    const second = createUtterance(SENTENCES.delayed[1], "Verzögert Satz 2", voice, 1);
    let calledAt = 0;
    second.addEventListener("start", () => {
      // start: Das Sprechen hat begonnen [M63].
      finishDelayedRun(run, "Satz 2 ohne Tipp gestartet: ja, start " + (Date.now() - calledAt) + " ms nach speak()", "ok");
    });
    second.addEventListener("error", (event) => {
      // Nach einem start steht das Ergebnis schon fest; finishDelayedRun ändert es nicht mehr.
      finishDelayedRun(run, "Satz 2 ohne Tipp gestartet: nein, error " + event.error + " – " + explainSynthesisError(event.error), "err");
    });
    calledAt = Date.now();
    try {
      synth.speak(second);
    } catch (error) {
      finishDelayedRun(run, "Satz 2 ohne Tipp gestartet: nein, Ausnahme bei speak(): " + describeError(error), "err");
      return;
    }
    // speaking und pending zeigen direkt nach speak(), ob eine Äußerung läuft oder wartet [M17, M18].
    const afterSpeak = "speaking " + synth.speaking + ", pending " + synth.pending;
    logTts("Verzögert, Lauf " + run.number + ": speak() für Satz 2 ohne Tipp aufgerufen, " + (DELAYED_GAP_MS / 1000) +
      " s nach dem Ende von Satz 1 (danach " + afterSpeak + ")");
    updateDelayedRun(run, "speak() für Satz 2 ohne Tipp aufgerufen, warte auf start");
    // Verlangt iOS eine Nutzeraktion und läuft keine, kehrt speak() ohne jedes Ereignis zurück [M66, M67]; darum die Frist.
    run.startTimer = setTimeout(() => {
      finishDelayedRun(run, "Satz 2 ohne Tipp gestartet: nein, kein start-Ereignis nach " + (DELAYED_START_TIMEOUT_MS / 1000) +
        " s (direkt nach speak(): " + afterSpeak + ")", "err");
    }, DELAYED_START_TIMEOUT_MS);
  }

  // ---------- 5. Übung ohne Netz ----------

  function playExercise() {
    const status = $("ex-status");
    const synth = window.speechSynthesis;
    report.exercise = [];
    $("ex-result").textContent = "–";
    state.exercise = { started: false, revealed: false };

    function reveal(reason) {
      if (state.exercise.revealed) {
        return;
      }
      state.exercise.revealed = true;
      setStatus(status, reason + ". Der Satz als Text: " + SENTENCES.exercise, "err");
      report.exercise.push(timeStamp() + " " + reason + "; Satz als Text gezeigt");
      renderReport();
    }

    if (!synth) {
      reveal("speechSynthesis nicht vorhanden");
      return;
    }
    stopDelayedRun("Übung gestartet");
    if (synth.speaking || synth.pending) {
      synth.cancel();
    }

    const voice = selectedVoice();
    const utterance = new SpeechSynthesisUtterance(SENTENCES.exercise);
    utterance.lang = voice ? voice.lang : "en-GB";
    if (voice) {
      utterance.voice = voice;
    }
    const timer = setTimeout(() => {
      if (!state.exercise.started) {
        reveal("Kein start-Ereignis nach " + (EXERCISE_START_TIMEOUT_MS / 1000) + " s");
      }
    }, EXERCISE_START_TIMEOUT_MS);
    utterance.addEventListener("start", () => {
      state.exercise.started = true;
      clearTimeout(timer);
      setStatus(status, "Wird gesprochen …", "warn");
      report.exercise.push(timeStamp() + " Anhören: start");
      renderReport();
    });
    utterance.addEventListener("end", () => {
      setStatus(status, "Gesprochen. Jetzt die richtige Bedeutung antippen.", "ok");
      report.exercise.push(timeStamp() + " Anhören: end");
      renderReport();
    });
    utterance.addEventListener("error", (event) => {
      clearTimeout(timer);
      reveal("Fehler " + event.error + " – " + explainSynthesisError(event.error));
    });
    state.utterances.push(utterance);
    setStatus(status, "Eingereiht …");
    report.exercise.push(timeStamp() + " Anhören: eingereiht, Stimme " + describeVoiceChoice(voice) +
      ", navigator.onLine " + navigator.onLine);
    synth.speak(utterance);
    renderReport();
  }

  function answerExercise(index) {
    const correct = index === EXERCISE_CORRECT_INDEX;
    const labels = Array.from(document.querySelectorAll("[data-answer]")).map((button) => button.textContent);
    setStatus($("ex-result"), correct ? "Richtig." : "Falsch. Richtig ist: " + labels[EXERCISE_CORRECT_INDEX],
      correct ? "ok" : "err");
    report.exercise.push(timeStamp() + " Antwort \"" + labels[index] + "\": " + (correct ? "richtig" : "falsch"));
    renderReport();
  }

  // ---------- 6. Speichern ----------

  function readLocalCounter() {
    try {
      // localStorage speichert Zeichenketten [M37], darum JSON.
      const raw = window.localStorage.getItem(LOCAL_KEY);
      return { value: raw === null ? null : JSON.parse(raw) };
    } catch (error) {
      return { error: describeError(error) };
    }
  }

  function writeLocalCounter(record) {
    try {
      window.localStorage.setItem(LOCAL_KEY, JSON.stringify(record));
      return null;
    } catch (error) {
      return describeError(error);
    }
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error("indexedDB nicht vorhanden"));
        return;
      }
      let request;
      try {
        // open(name, version) [M39]; upgradeneeded feuert, wenn die Version höher ist als die vorhandene [M40].
        request = window.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (error) {
        reject(error);
        return;
      }
      request.addEventListener("upgradeneeded", () => {
        request.result.createObjectStore(STORE_NAME);
      });
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => reject(request.error || new Error("open fehlgeschlagen")));
      request.addEventListener("blocked", () => reject(new Error("open blockiert")));
    });
  }

  function readDbCounter() {
    return openDatabase().then((db) => new Promise((resolve, reject) => {
      // Transaktion readonly [M41]; get liefert ohne Treffer undefined [M43].
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).get(COUNTER_KEY);
      request.addEventListener("success", () => resolve(request.result === undefined ? null : request.result));
      request.addEventListener("error", () => reject(request.error || new Error("get fehlgeschlagen")));
      tx.addEventListener("complete", () => db.close());
      tx.addEventListener("abort", () => {
        db.close();
        reject(tx.error || new Error("Transaktion abgebrochen"));
      });
    }));
  }

  function writeDbCounter(record) {
    return openDatabase().then((db) => new Promise((resolve, reject) => {
      // Transaktion readwrite [M41]; put legt an oder ersetzt [M42]; complete meldet den Abschluss [M44].
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(record, COUNTER_KEY);
      tx.addEventListener("complete", () => {
        db.close();
        resolve();
      });
      tx.addEventListener("error", () => {
        db.close();
        reject(tx.error || new Error("put fehlgeschlagen"));
      });
      tx.addEventListener("abort", () => {
        db.close();
        reject(tx.error || new Error("Transaktion abgebrochen"));
      });
    }));
  }

  function describeRecord(result) {
    if (result.error) {
      return "Fehler: " + result.error;
    }
    if (result.value === null) {
      return "kein Eintrag";
    }
    const record = result.value;
    if (!record || typeof record !== "object" || !Number.isInteger(record.count)) {
      return "unerwarteter Inhalt: " + JSON.stringify(record);
    }
    return record.count + " (zuletzt geändert " + record.updatedAt + ")";
  }

  function recordCount(result) {
    return result && result.value && typeof result.value === "object" && Number.isInteger(result.value.count)
      ? result.value.count
      : null;
  }

  function highest(values) {
    let best = 0;
    values.forEach((value) => {
      if (Number.isInteger(value) && value > best) {
        best = value;
      }
    });
    return best;
  }

  async function refreshStorageDisplay() {
    const local = readLocalCounter();
    let db;
    try {
      db = { value: await readDbCounter() };
    } catch (error) {
      db = { error: describeError(error) };
    }
    state.counter = highest([recordCount(local), recordCount(db), state.counter]);
    report.storage.local = describeRecord(local);
    report.storage.db = describeRecord(db);
    $("store-local").textContent = report.storage.local;
    $("store-idb").textContent = report.storage.db;
    renderReport();
  }

  async function writeCounterEverywhere(count, label) {
    // Zeitpunkt der letzten Änderung in UTC [M60].
    const record = { count: count, updatedAt: new Date().toISOString() };
    const localError = writeLocalCounter(record);
    let dbError = null;
    try {
      await writeDbCounter(record);
    } catch (error) {
      dbError = describeError(error);
    }
    report.storage.log.push(timeStamp() + " " + label + " auf " + count + ": localStorage " +
      (localError ? "Fehler " + localError : "ok") + ", IndexedDB " + (dbError ? "Fehler " + dbError : "ok"));
    return !localError && !dbError;
  }

  async function incrementCounter() {
    const button = $("btn-counter");
    button.disabled = true;
    try {
      await writeCounterEverywhere(state.counter + 1, "Zähler +1");
      await refreshStorageDisplay();
    } finally {
      button.disabled = false;
    }
  }

  async function checkPersisted() {
    const cell = $("store-persisted");
    if (!(navigator.storage && typeof navigator.storage.persisted === "function")) {
      report.storage.persisted = "nicht verfügbar";
    } else {
      try {
        // persisted(): true, wenn der Speicher der Seite dauerhaft ist [M45].
        const result = await navigator.storage.persisted();
        report.storage.persisted = String(result) + " (beim Öffnen)";
      } catch (error) {
        report.storage.persisted = "Fehler " + describeError(error);
      }
    }
    cell.textContent = report.storage.persisted;
    renderReport();
  }

  async function requestPersist() {
    const cell = $("store-persist");
    if (!(navigator.storage && typeof navigator.storage.persist === "function")) {
      report.storage.persist = "nicht verfügbar";
    } else {
      try {
        // persist() fragt dauerhaften Speicher an; der Browser entscheidet nach eigenen Regeln [M46] (Quelle 14).
        const result = await navigator.storage.persist();
        report.storage.persist = String(result) + " (" + timeStamp() + ")";
        if (typeof navigator.storage.persisted === "function") {
          const after = await navigator.storage.persisted();
          report.storage.log.push(timeStamp() + " persisted() nach persist(): " + after);
        }
      } catch (error) {
        report.storage.persist = "Fehler " + describeError(error);
      }
    }
    cell.textContent = report.storage.persist;
    renderReport();
  }

  // ---------- 7. Sichern und Einlesen ----------

  function buildBackup() {
    return {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      pageVersion: VERSION,
      counter: state.counter,
      savedAt: new Date().toISOString()
    };
  }

  function backupFileName() {
    // Datum aus toISOString (UTC) [M60], ohne persönliche Angaben.
    return "radiology-english-machbarkeit-" + new Date().toISOString().slice(0, 10) + ".json";
  }

  function logBackup(text, level) {
    report.backup.push(timeStamp() + " " + text);
    setStatus($("backup-status"), text, level);
    renderReport();
  }

  function downloadBackup() {
    const json = JSON.stringify(buildBackup(), null, 2);
    const fileName = backupFileName();
    let url = null;
    try {
      // Blob mit MIME-Typ [M47], Objekt-URL [M49], Attribut download mit Dateiname, erlaubt für blob: [M50].
      const blob = new Blob([json], { type: "application/json" });
      url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      logBackup("Herunterladen ausgelöst: " + fileName + " (" + json.length + " Zeichen)", "ok");
    } catch (error) {
      logBackup("Herunterladen fehlgeschlagen: " + describeError(error), "err");
    }
    if (url) {
      // Objekt-URL später freigeben [M49]; wann das gefahrlos ist, ist offen.
      setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_RELEASE_MS);
    }
  }

  function fileSharingSupported() {
    if (typeof navigator.canShare !== "function" || typeof navigator.share !== "function") {
      return false;
    }
    try {
      // canShare prüft, ob Dateien geteilt werden können [M51]; File-Konstruktor [M48].
      const probe = new File(["{}"], "probe.json", { type: "application/json" });
      return navigator.canShare({ files: [probe] });
    } catch (error) {
      return false;
    }
  }

  function shareBackup() {
    const json = JSON.stringify(buildBackup(), null, 2);
    let data;
    try {
      data = {
        files: [new File([json], backupFileName(), { type: "application/json" })],
        title: "Radiology English Machbarkeitstest"
      };
    } catch (error) {
      logBackup("Teilen: Datei konnte nicht erzeugt werden: " + describeError(error), "err");
      return;
    }
    if (!navigator.canShare(data)) {
      logBackup("Teilen: navigator.canShare lehnt die Datei ab", "err");
      return;
    }
    // share() braucht eine Nutzeraktion und läuft darum direkt im Klick; Fehlernamen nach [M52].
    navigator.share(data)
      .then(() => logBackup("Teilen abgeschlossen: " + data.files[0].name, "ok"))
      .catch((error) => logBackup("Teilen: " + describeError(error) +
        " (AbortError: abgebrochen oder kein Ziel; NotAllowedError: nicht erlaubt)", "err"));
  }

  function validateBackup(data) {
    const problems = [];
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return ["kein JSON-Objekt"];
    }
    if (data.format !== BACKUP_FORMAT) {
      problems.push("format ist " + JSON.stringify(data.format) + ", erwartet \"" + BACKUP_FORMAT + "\"");
    }
    if (data.formatVersion !== BACKUP_FORMAT_VERSION) {
      problems.push("formatVersion ist " + JSON.stringify(data.formatVersion) + ", erwartet " + BACKUP_FORMAT_VERSION);
    }
    if (!Number.isInteger(data.counter) || data.counter < 0) {
      problems.push("counter fehlt oder ist keine ganze Zahl ab 0");
    }
    if (typeof data.savedAt !== "string" || !data.savedAt) {
      problems.push("savedAt fehlt");
    }
    if (typeof data.pageVersion !== "string" || !data.pageVersion) {
      problems.push("pageVersion fehlt");
    }
    return problems;
  }

  function logImport(field, text, level) {
    report.backup.push(timeStamp() + " Einlesen über " + field.label + ": " + text);
    setStatus($("import-status"), field.label + ": " + text, level);
    renderReport();
  }

  function importLines() {
    if (!report.imports.length) {
      return ["Eingelesen: noch nicht"];
    }
    return report.imports.map((entry) => "Eingelesen über " + entry.field + ": " + entry.at + ", Zähler " + entry.counter +
      (entry.ok ? "" : ", mindestens ein Speicher meldete einen Fehler"));
  }

  // Für das Ergebnis nur Endung, Typ und Größe, nicht den Dateinamen: Über das Feld ohne accept lässt sich jede Datei wählen,
  // und das Ergebnis geht in den Chat. name enthält keinen Pfad [M71]; type leitet der Browser aus der Endung ab und kann leer sein [M69]; size in Byte [M70].
  function describeChosenFile(file) {
    const ending = /\.[a-z0-9]{1,5}$/i.exec(file.name);
    return "Endung " + (ending ? ending[0] : "keine") + ", Typ " + (file.type || "leer") + ", " + file.size + " Byte";
  }

  // Beide Dateifelder laufen hier durch dieselbe Prüfung (validateBackup) und dieselbe Nachfrage.
  async function importBackup(input, field) {
    // files hält die gewählten Dateien [M53].
    const file = input.files && input.files[0];
    if (!file) {
      return;
    }
    logImport(field, "Datei gewählt, " + describeChosenFile(file));
    let text;
    try {
      // text() liest die Datei als UTF-8 [M54].
      text = await file.text();
    } catch (error) {
      logImport(field, "Datei konnte nicht gelesen werden: " + describeError(error), "err");
      input.value = "";
      return;
    }
    let data;
    try {
      // JSON.parse wirft SyntaxError bei ungültigem JSON [M55]. Nur der Name des Fehlers geht ins Ergebnis: Sein Text kann
      // die Datei zitieren (gemessen mit Node v24.20.0 am 06.11.2026, für Safari offen), und das Feld ohne accept nimmt jede Datei.
      data = JSON.parse(text);
    } catch (error) {
      logImport(field, "Kein gültiges JSON (" + error.name + ")", "err");
      input.value = "";
      return;
    }
    const problems = validateBackup(data);
    if (problems.length) {
      logImport(field, "Datei abgelehnt: " + problems.join("; "), "err");
      input.value = "";
      return;
    }
    // Nachfrage vor dem Ersetzen; confirm liefert true für OK [M56].
    const question = "Vorhandenen Zählerstand " + state.counter + " durch " + data.counter + " aus der Datei ersetzen?\n" +
      "Datei: " + file.name + ", gesichert " + data.savedAt + ", Seite " + data.pageVersion;
    if (!window.confirm(question)) {
      logImport(field, "abgebrochen, Zähler bleibt " + state.counter, "warn");
      input.value = "";
      return;
    }
    const ok = await writeCounterEverywhere(data.counter, "Einlesen");
    state.counter = data.counter;
    await refreshStorageDisplay();
    report.imports.push({ field: field.label, at: timeStamp(), counter: state.counter, ok: ok });
    logImport(field, "Zähler jetzt " + state.counter + (ok ? "" : " (mindestens ein Speicher meldete einen Fehler, siehe Speichern)"),
      ok ? "ok" : "warn");
    input.value = "";
  }

  // ---------- 8. Tastatur ----------

  function echoKeyboard() {
    const text = $("kb-input").value;
    const echo = $("kb-echo");
    echo.textContent = "";
    if (!text) {
      echo.textContent = "(leer)";
    } else {
      // Zeichenweise ausgeben, Leerzeichen als ␣ sichtbar; das Feld selbst bleibt unverändert.
      Array.from(text).forEach((character) => {
        if (character === " ") {
          const marker = document.createElement("span");
          marker.className = "space";
          marker.textContent = "␣";
          echo.appendChild(marker);
        } else {
          echo.appendChild(document.createTextNode(character));
        }
      });
    }
    // length zählt UTF-16-Einheiten [M57].
    $("kb-count").textContent = "Zeichen (length): " + text.length;
    report.keyboard = ["Echo: \"" + text + "\"", "Zeichen (length): " + text.length, "Zeit: " + timeStamp()];
    renderReport();
  }

  // ---------- 1. und 9. Versionen und Aktualisierung (Service Worker) ----------

  function logUpdate(text) {
    report.update.push(timeStamp() + " " + text);
    renderReport();
  }

  function swVersionText() {
    if (state.swVersionNote) {
      return state.swVersionNote;
    }
    if (state.swVersion === null) {
      return "kein Service Worker aktiv";
    }
    if (state.swVersion === undefined) {
      return "wird abgefragt …";
    }
    return state.swVersion + (state.swVersion === VERSION ? "" : " – weicht von der Seite ab!");
  }

  function setSwVersion(version, note) {
    clearTimeout(state.versionTimer);
    state.swVersion = version;
    state.swVersionNote = note || "";
    $("sw-version").textContent = swVersionText();
    $("version-mismatch").hidden = !(typeof version === "string" && version !== VERSION);
    renderReport();
  }

  function queryServiceWorkerVersion() {
    if (!("serviceWorker" in navigator)) {
      setSwVersion(null);
      return;
    }
    // controller: der steuernde Service Worker oder null, auch null nach erzwungenem Neuladen [M28].
    const controller = navigator.serviceWorker.controller;
    if (!controller) {
      setSwVersion(null);
      return;
    }
    state.swVersion = undefined;
    state.swVersionNote = "";
    $("sw-version").textContent = swVersionText();
    // Nachricht an den Service Worker; die Antwort kommt als message auf navigator.serviceWorker [M35].
    controller.postMessage({ type: "getVersion" });
    clearTimeout(state.versionTimer);
    state.versionTimer = setTimeout(() => {
      if (state.swVersion === undefined) {
        setSwVersion(undefined, "keine Antwort vom Service Worker nach " + (SW_VERSION_TIMEOUT_MS / 1000) + " s");
      }
    }, SW_VERSION_TIMEOUT_MS);
  }

  function onServiceWorkerMessage(event) {
    const data = event.data;
    if (!data || typeof data !== "object") {
      return;
    }
    if (data.type === "version") {
      setSwVersion(String(data.version));
    } else if (data.type === "installResult") {
      onInstallResult(data);
    }
  }

  // Hinweis im Abschnitt Aktualisierung, wenn die Registrierung oder die Installation fehlschlägt, mit dem Fehlertext.
  function showUpdateError(text) {
    const notice = $("update-error");
    notice.textContent = text;
    notice.hidden = false;
    report.updateNotice = text;
    renderReport();
  }

  // Der Fehlertext kommt aus der Meldung des Service Workers; die Doku von register() und update() nennt keine Ablehnung
  // bei gescheiterter Installation [M29, M30]. Beim nächsten Öffnen prüfen Browser und Seite sw.js erneut (Quelle 31, [M30]).
  function showInstallFailure() {
    const detail = state.installFailureDetail ||
      "keine Meldung des Service Workers erhalten, die Ursache steht in seiner Konsole";
    setStatus($("update-status"), "Installation des Service Workers fehlgeschlagen, siehe Hinweis.", "err");
    showUpdateError("Installation des neuen Service Workers fehlgeschlagen: " + detail + ". " +
      (navigator.serviceWorker.controller ? "Der bisherige Service Worker bleibt aktiv. " : "") +
      "Beim nächsten Öffnen versucht es der Browser erneut.");
  }

  // Meldung aus sw.js zur Installation: Versionsprüfung bestanden oder Fehlertext. Ihre Reihenfolge gegenüber dem Zustand redundant
  // ist nicht belegt, darum führen beide Wege zum selben Hinweis.
  function onInstallResult(data) {
    report.swChecks.push(timeStamp() + " Service Worker " + data.version + ": " +
      (data.ok ? "bestanden, " : "Installation abgebrochen, ") + data.detail);
    if (data.ok) {
      renderReport();
      return;
    }
    state.installFailureDetail = String(data.detail);
    showInstallFailure();
  }

  function serviceWorkerCheckLines() {
    const lines = [];
    if (report.swChecks.length) {
      lines.push("Versionsprüfung des Service Workers, Meldungen in dieser Sitzung:");
      report.swChecks.forEach((line) => lines.push("  " + line));
    } else {
      lines.push("Versionsprüfung des Service Workers: keine Meldung in dieser Sitzung (keine Installation, oder die Meldung kam nicht an). " +
        "Ab Version 0.1.1 wird ein Service Worker nur nach bestandener Prüfung aktiv.");
    }
    if (report.updateNotice) {
      lines.push("Hinweis auf der Seite: " + report.updateNotice);
    }
    return lines;
  }

  // Beobachtet einen neuen Service Worker; statechange feuert bei jeder Änderung von state [M72, M34].
  function watchInstallingWorker(worker) {
    if (state.watchedWorkers.has(worker)) {
      return;
    }
    state.watchedWorkers.add(worker);
    let installed = worker.state !== "installing";
    worker.addEventListener("statechange", () => {
      logUpdate("Zustand des neuen Service Workers: " + worker.state);
      if (worker.state === "installed") {
        installed = true;
        if (navigator.serviceWorker.controller) {
          showUpdateReady();
        } else {
          setStatus($("update-status"), "Service Worker zum ersten Mal installiert.", "ok");
        }
      } else if (worker.state === "redundant" && !installed) {
        // redundant: durch einen neueren Worker ersetzt oder wegen einer gescheiterten Installation verworfen [M34].
        // Vor dem Zustand installed zählt die Seite es als gescheitert; der Fall „ersetzt“ würde hier mitgemeldet.
        showInstallFailure();
      }
    });
  }

  function onControllerChange() {
    // controllerchange: die Registrierung hat einen neuen aktiven Worker [M36].
    if (state.updateRequested && !state.reloading) {
      state.reloading = true;
      logUpdate("controllerchange nach Aktualisierung, Seite lädt neu");
      window.location.reload();
      return;
    }
    logUpdate("controllerchange (Service Worker hat die Seite übernommen)");
    updateEnvironmentRow("Service Worker steuert die Seite", controllerText());
    queryServiceWorkerVersion();
  }

  function showUpdateReady() {
    if (state.updateReady) {
      return;
    }
    state.updateReady = true;
    setStatus($("update-status"), "Neue Version bereit. Erst der Tipp auf „Jetzt aktualisieren“ wechselt die Version.", "warn");
    $("btn-update").hidden = false;
    logUpdate("Neue Version bereit (wartender Service Worker)");
  }

  function activateUpdate() {
    // waiting: der installierte, wartende Worker [M31].
    const waiting = state.registration && state.registration.waiting;
    if (!waiting) {
      setStatus($("update-status"), "Kein wartender Service Worker vorhanden.", "warn");
      logUpdate("Jetzt aktualisieren: kein wartender Service Worker");
      return;
    }
    state.updateRequested = true;
    // Der wartende Worker ruft auf diese Nachricht skipWaiting() auf (sw.js) [M35]; die Seite lädt bei controllerchange neu.
    waiting.postMessage({ type: "skipWaiting" });
    setStatus($("update-status"), "Aktivierung angefordert, die Seite lädt gleich neu …", "warn");
    logUpdate("Jetzt aktualisieren getippt, skipWaiting angefordert");
  }

  function setupServiceWorker() {
    const status = $("update-status");
    if (!("serviceWorker" in navigator)) {
      setStatus(status, "Service Worker nicht vorhanden.", "err");
      setSwVersion(null);
      return;
    }
    // Meldungen des Service Workers kommen als message auf navigator.serviceWorker an [M73]; laut Doku hält der Browser
    // die seines steuernden Workers bis nach DOMContentLoaded zurück [M74], die Seite hört vorher schon zu.
    navigator.serviceWorker.addEventListener("message", onServiceWorkerMessage);
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    queryServiceWorkerVersion();

    // Relativer Pfad; der Bereich ist damit der Ordner dieses Skripts (Quelle 40, [M29]).
    // updateViaCache "none": sw.js wird nie aus dem HTTP-Cache geholt [M29], denn GitHub Pages liefert max-age=600 (Quelle 32).
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((registration) => {
      state.registration = registration;
      const scopePath = new URL(registration.scope).pathname;
      setStatus(status, "Registriert, Bereich " + scopePath + ". Suche nach Aktualisierung …");
      logUpdate("Registriert, Bereich " + scopePath);

      if (registration.waiting && navigator.serviceWorker.controller) {
        showUpdateReady();
      }
      // Läuft schon eine Installation [M32], beobachtet die Seite sie auch ohne updatefound.
      if (registration.installing) {
        watchInstallingWorker(registration.installing);
      }

      // updatefound: registration.installing hat einen neuen Worker [M33, M32].
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) {
          return;
        }
        logUpdate("updatefound: neuer Service Worker wird installiert");
        watchInstallingWorker(installing);
      });

      // update() holt sw.js und installiert bei Unterschied [M30].
      return registration.update().then(() => {
        if (registration.installing) {
          logUpdate("update(): Installation läuft");
          watchInstallingWorker(registration.installing);
        } else if (registration.waiting) {
          if (navigator.serviceWorker.controller) {
            showUpdateReady();
          }
        } else if (!state.updateReady && !report.updateNotice) {
          setStatus(status, (navigator.serviceWorker.controller
            ? "Keine neue Version gefunden ("
            : "Service Worker vorhanden, keine weitere Version gefunden (") + timeStamp() + ").", "ok");
          logUpdate("update(): keine neue Version");
        }
      }).catch((error) => {
        logUpdate("update() fehlgeschlagen: " + describeError(error));
        setStatus(status, "Suche nach Aktualisierung fehlgeschlagen: " + describeError(error), "err");
      });
    }).catch((error) => {
      setStatus(status, "Registrierung des Service Workers fehlgeschlagen, siehe Hinweis.", "err");
      logUpdate("Registrierung fehlgeschlagen: " + describeError(error));
      showUpdateError("Registrierung des Service Workers fehlgeschlagen: " + describeError(error));
    });
  }

  // ---------- Start ----------

  function bindButtons() {
    $("btn-rec-gb").addEventListener("click", () => startRecognition("en-GB"));
    $("btn-rec-us").addEventListener("click", () => startRecognition("en-US"));
    $("btn-tts-once").addEventListener("click", () => speakSentences([SENTENCES.single], "Satz", 1));
    $("btn-tts-slow").addEventListener("click", () => speakSentences([SENTENCES.single], "Langsam", 0.7));
    $("btn-tts-two").addEventListener("click", () => speakSentences(SENTENCES.two, "Zwei Sätze", 1));
    $("btn-tts-delayed").addEventListener("click", startDelayedRun);
    $("btn-tts-long").addEventListener("click", () => speakSentences(SENTENCES.long, "Langer Text", 1));
    $("btn-voices-reload").addEventListener("click", () => loadVoices("tap"));
    $("voice-select").addEventListener("change", () => {
      const voice = selectedVoice();
      state.selectedVoiceKey = voice ? voiceKey(voice) : null;
    });
    $("btn-ex-play").addEventListener("click", playExercise);
    document.querySelectorAll("[data-answer]").forEach((button) => {
      button.addEventListener("click", () => answerExercise(Number(button.getAttribute("data-answer"))));
    });
    $("btn-counter").addEventListener("click", incrementCounter);
    $("btn-persist").addEventListener("click", requestPersist);
    $("btn-download").addEventListener("click", downloadBackup);
    $("btn-share").addEventListener("click", shareBackup);
    IMPORT_FIELDS.forEach((field) => {
      $(field.id).addEventListener("change", (event) => importBackup(event.target, field));
    });
    $("btn-kb").addEventListener("click", echoKeyboard);
    $("btn-update").addEventListener("click", activateUpdate);
    $("btn-select-all").addEventListener("click", selectReport);
  }

  function init() {
    $("page-version").textContent = VERSION;
    collectEnvironment();
    detectApis();
    bindButtons();
    watchNetwork();
    watchVisibility();
    loadVoices("open");
    if (window.speechSynthesis) {
      window.speechSynthesis.addEventListener("voiceschanged", () => loadVoices("changed"));
    }
    if (fileSharingSupported()) {
      report.backup.push("Teilen mit Datei: canShare ja");
    } else {
      $("btn-share").disabled = true;
      setStatus($("backup-status"),
        "Teilen mit Datei nicht möglich: navigator.canShare fehlt oder lehnt Dateien ab. Bitte „Herunterladen“ nutzen.", "warn");
      report.backup.push("Teilen mit Datei: nicht möglich (canShare)");
    }
    refreshStorageDisplay();
    checkPersisted();
    setupServiceWorker();
    renderReport();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
