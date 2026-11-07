import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createWorkerControl } from "../js/ui/worker-control.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));

function fakeWorker(state = "installing") {
  const worker = new EventTarget();
  worker.state = state;
  worker.posted = [];
  worker.postMessage = (message) => worker.posted.push(message);
  worker.moveTo = (next) => {
    worker.state = next;
    worker.dispatchEvent(new Event("statechange"));
  };
  return worker;
}

function fakeRegistration({ installing = null, waiting = null, update = async () => {} } = {}) {
  const registration = new EventTarget();
  registration.installing = installing;
  registration.waiting = waiting;
  registration.updateCalls = 0;
  registration.update = () => {
    registration.updateCalls += 1;
    return update();
  };
  return registration;
}

function fakeContainer(registration, { controller = fakeWorker("activated"), fails = false } = {}) {
  const container = new EventTarget();
  container.controller = controller;
  container.registered = [];
  container.register = (...args) => {
    container.registered.push(args);
    return fails ? Promise.reject(new Error("abgelehnt")) : Promise.resolve(registration);
  };
  return container;
}

// Meldet sich an und wartet, bis register aufgelöst hat.
async function started(registration, options) {
  const container = fakeContainer(registration, options);
  const reloads = [];
  const control = createWorkerControl(container, { reload: () => reloads.push("reload") });
  let announced = 0;
  control.onUpdateReady(() => {
    announced += 1;
  });
  control.register();
  await flush();
  return { control, container, reloads, announced: () => announced };
}

describe("createWorkerControl", () => {
  it("meldet sw.js an, am HTTP-Cache vorbei", async () => {
    const { container } = await started(fakeRegistration());
    assert.deepEqual(container.registered, [["sw.js", { updateViaCache: "none" }]]);
  });

  it("wartet schon ein Worker, ist die neue Version gleich bereit", async () => {
    const { control, announced } = await started(fakeRegistration({ waiting: fakeWorker("installed") }));
    assert.equal(control.isUpdateReady(), true);
    assert.equal(announced(), 1);
  });

  it("läuft die Installation schon, wenn register auflöst, wird sie trotzdem beobachtet", async () => {
    const installing = fakeWorker();
    const { control, announced } = await started(fakeRegistration({ installing }));
    assert.equal(control.isUpdateReady(), false);
    installing.moveTo("installed");
    assert.equal(control.isUpdateReady(), true);
    assert.equal(announced(), 1);
  });

  it("eine Installation nach dem Anmelden meldet sich über updatefound", async () => {
    const registration = fakeRegistration();
    const { control, announced } = await started(registration);
    const incoming = fakeWorker();
    registration.installing = incoming;
    registration.dispatchEvent(new Event("updatefound"));
    assert.equal(control.isUpdateReady(), false);
    incoming.moveTo("installed");
    assert.equal(control.isUpdateReady(), true);
    assert.equal(announced(), 1);
  });

  it("derselbe Worker meldet sich nur einmal, auch wenn updatefound nachkommt", async () => {
    const installing = fakeWorker();
    const registration = fakeRegistration({ installing });
    const { announced } = await started(registration);
    registration.dispatchEvent(new Event("updatefound"));
    installing.moveTo("installed");
    assert.equal(announced(), 1);
  });

  it("die erste Installation ist keine neue Version", async () => {
    const installing = fakeWorker();
    const { control, announced } = await started(fakeRegistration({ installing }), { controller: null });
    installing.moveTo("installed");
    assert.equal(control.isUpdateReady(), false);
    assert.equal(announced(), 0);
  });

  it("ein Worker, der scheitert, ist keine neue Version", async () => {
    const installing = fakeWorker();
    const { control } = await started(fakeRegistration({ installing }));
    installing.moveTo("redundant");
    assert.equal(control.isUpdateReady(), false);
  });

  it("wer sich abmeldet, hört nichts mehr", async () => {
    const installing = fakeWorker();
    const { control } = await started(fakeRegistration({ installing }));
    let heard = 0;
    const stop = control.onUpdateReady(() => {
      heard += 1;
    });
    stop();
    installing.moveTo("installed");
    assert.equal(heard, 0);
  });

  it("neu geladen wird nur nach „Jetzt aktualisieren“", async () => {
    const waiting = fakeWorker("installed");
    const { control, container, reloads } = await started(fakeRegistration({ waiting }));
    container.dispatchEvent(new Event("controllerchange"));
    assert.deepEqual(reloads, [], "auch die erste Installation meldet controllerchange");
    control.applyUpdate();
    assert.deepEqual(waiting.posted, [{ type: "skipWaiting" }]);
    assert.deepEqual(reloads, [], "erst der Wechsel lädt neu");
    container.dispatchEvent(new Event("controllerchange"));
    assert.deepEqual(reloads, ["reload"]);
  });

  it("ohne wartenden Worker schickt applyUpdate nichts und lädt nicht neu", async () => {
    const { control, container, reloads } = await started(fakeRegistration());
    control.applyUpdate();
    container.dispatchEvent(new Event("controllerchange"));
    assert.deepEqual(reloads, []);
  });

  it("checkForUpdate fragt nach und übersteht fehlendes Netz", async () => {
    const registration = fakeRegistration({
      update: async () => {
        throw new TypeError("Kein Netz");
      },
    });
    const { control } = await started(registration);
    control.checkForUpdate();
    await flush();
    assert.equal(registration.updateCalls, 1);
  });

  it("vor dem Anmelden tut checkForUpdate nichts", () => {
    const registration = fakeRegistration();
    const control = createWorkerControl(fakeContainer(registration));
    control.checkForUpdate();
    assert.equal(registration.updateCalls, 0);
  });

  it("scheitert das Anmelden, läuft die App weiter", async () => {
    const { control } = await started(fakeRegistration(), { fails: true });
    assert.equal(control.isUpdateReady(), false);
    control.checkForUpdate();
    control.applyUpdate();
  });

  it("ohne Service Worker im Browser bleibt alles still", async () => {
    const control = createWorkerControl(null);
    control.register();
    control.checkForUpdate();
    control.applyUpdate();
    assert.equal(await control.version(), null);
    assert.equal(control.isUpdateReady(), false);
  });

  it("version fragt den laufenden Worker und antwortet ohne ihn mit null", async () => {
    const controller = fakeWorker("activated");
    controller.postMessage = (message) => {
      assert.deepEqual(message, { type: "getVersion" });
      const answer = new Event("message");
      answer.data = { type: "version", version: "1.2.3" };
      container.dispatchEvent(answer);
    };
    const container = fakeContainer(fakeRegistration(), { controller });
    assert.equal(await createWorkerControl(container).version(), "1.2.3");
    assert.equal(await createWorkerControl(fakeContainer(fakeRegistration(), { controller: null })).version(), null);
  });
});
