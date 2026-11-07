// Einstieg für den Befehl aus dem Bauauftrag, node --test test/. Node 24 startet den Ordner als Modul, also diese Datei.
// Ohne sie scheitert der Befehl mit „Cannot find module“. Neue *.test.js kommen von selbst dazu.
// Quellen: https://nodejs.org/api/test.html#running-tests-from-the-command-line und https://nodejs.org/api/modules.html#folders-as-modules

import { readdirSync } from "node:fs";

const names = readdirSync(new URL("./", import.meta.url)).filter((name) => name.endsWith(".test.js")).sort();
for (const name of names) {
  await import(new URL(name, import.meta.url).href);
}
