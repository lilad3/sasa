// Le BFF face à un Django lent ou en panne (docs/chantier-a2-fondations.md §3).
// Un faux Django local répond selon le chemin appelé ; on compte combien de fois chaque chemin est reçu.
// Lancer : npm test (Node 24 lit lib/server/api.ts directement). Durée : environ 25 s, à cause des vrais délais.
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { after, before, describe, test } from "node:test";

const hits = new Map();
const requestIds = new Map();
const EXPORT = "shops/maison-adjoua/orders/export?from=2026-10-01&to=2026-10-23";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Pour chaque chemin : ce que Django répond à la n-ième tentative (1, 2…).
const SCRIPTS = {
  "lent-15s": async () => (await wait(15_000), [200, { ok: true }]),
  "muet-25s": async () => (await wait(25_000), [200, { ok: true }]),
  "502-rapide-puis-ok": async (n) => (n === 1 ? [502, {}] : [200, { ok: true }]),
  "502-toujours": async () => [502, {}],
  "502-lent": async () => (await wait(5_500), [502, {}]),
  "meme-id": async (n) => (n === 1 ? [502, {}] : [200, { ok: true }]),
  "storefront/maison-adjoua/orders": async () => [502, {}],
  [EXPORT]: async () => [502, {}],
  // 1 : échec lent (non relancé). 2 : échec rapide, relancé ; 3 : réussite.
  // 4 : échec rapide, relancé ; 5 : réponse en 5 s, trop tard pour la relance du refresh (3 s).
  "auth/token/refresh": async (n) =>
    n === 1 ? (await wait(5_500), [503, {}]) : n === 2 || n === 4 ? [503, {}] : n === 5 ? (await wait(5_000), [200, { access: "a" }]) : [200, { access: "a" }],
};

let server;

before(async () => {
  server = createServer(async (request, response) => {
    const path = request.url.replace(/^\/api\/v1\//, "");
    const count = (hits.get(path) ?? 0) + 1;
    hits.set(path, count);
    requestIds.set(path, [...(requestIds.get(path) ?? []), request.headers["x-request-id"]]);
    const script = SCRIPTS[path];
    const [status, body] = script ? await script(count) : [404, { code: "not_found" }];
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  process.env.API_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.BFF_SHARED_SECRET = "secret-de-test";
});

after(() => server.close());

const context = { ip: "", userAgent: "", deviceId: "" };
const api = () => import("../src/lib/server/api.ts");

describe("délais et relances du BFF", { concurrency: true }, () => {
  test("un GET qui répond en 15 s passe, sans relance", async () => {
    const { callApi } = await api();
    const result = await callApi("lent-15s", { context });
    assert.equal(result.ok, true);
    assert.equal(hits.get("lent-15s"), 1);
  });

  test("un GET sans réponse abandonne au bout de 20 s, sans relance", async () => {
    const { callApi } = await api();
    const started = Date.now();
    const result = await callApi("muet-25s", { context });
    const elapsed = Date.now() - started;
    assert.equal(result.ok, false);
    assert.equal(result.problem.code, "network_error");
    assert.ok(elapsed >= 19_500 && elapsed < 22_000, `${elapsed} ms`);
    assert.equal(hits.get("muet-25s"), 1);
  });

  test("un GET en 502 rapide est relancé une fois", async () => {
    const { callApi } = await api();
    const result = await callApi("502-rapide-puis-ok", { context });
    assert.equal(result.ok, true);
    assert.equal(hits.get("502-rapide-puis-ok"), 2);
  });

  test("un GET relancé n'est relancé qu'une fois", async () => {
    const { callApi } = await api();
    const result = await callApi("502-toujours", { context });
    assert.equal(result.ok, false);
    assert.equal(hits.get("502-toujours"), 2);
  });

  test("un GET qui échoue après plus de 5 s n'est pas relancé", async () => {
    const { callApi } = await api();
    const result = await callApi("502-lent", { context });
    assert.equal(result.ok, false);
    assert.equal(hits.get("502-lent"), 1);
  });

  test("les deux tentatives portent le même X-Request-ID", async () => {
    const { callApi } = await api();
    const result = await callApi("meme-id", { context });
    assert.equal(result.ok, true);
    const [first, second] = requestIds.get("meme-id");
    assert.match(first, /^web_[0-9a-f]{32}$/);
    assert.equal(second, first);
  });

  test("un export (GET) n'est jamais relancé : Django l'inscrit au journal", async () => {
    const { callApi } = await api();
    const result = await callApi(EXPORT, { context, as: "text" });
    assert.equal(result.ok, false);
    assert.equal(hits.get(EXPORT), 1);
  });

  test("une commande (POST) n'est jamais envoyée deux fois", async () => {
    const { callApi } = await api();
    const result = await callApi("storefront/maison-adjoua/orders", { method: "POST", body: { items: [] }, context, idempotencyKey: "cle-de-test-0001" });
    assert.equal(result.ok, false);
    assert.equal(hits.get("storefront/maison-adjoua/orders"), 1);
  });

  test("le refresh n'est pas relancé après un échec de plus de 5 s", async () => {
    const { callApi } = await api();
    const result = await callApi("auth/token/refresh", { method: "POST", body: { refresh: "x" }, context });
    assert.equal(result.ok, false);
    assert.equal(result.problem.status, 503);
    assert.equal(hits.get("auth/token/refresh"), 1);
  });
});

// Après le bloc précédent : le refresh a déjà été reçu une fois.
describe("refresh après un échec rapide", () => {
  test("il est relancé une fois, et la session est renouvelée", async () => {
    const { callApi } = await api();
    const result = await callApi("auth/token/refresh", { method: "POST", body: { refresh: "x" }, context });
    assert.equal(result.ok, true);
    assert.equal(hits.get("auth/token/refresh"), 3);
  });

  test("sa relance abandonne au bout de 3 s, avant la fin de la fenêtre de grâce", async () => {
    const { callApi } = await api();
    const started = Date.now();
    const result = await callApi("auth/token/refresh", { method: "POST", body: { refresh: "x" }, context });
    const elapsed = Date.now() - started;
    assert.equal(result.ok, false);
    assert.equal(result.problem.code, "network_error");
    assert.ok(elapsed >= 3_800 && elapsed < 5_000, `${elapsed} ms`);
    assert.equal(hits.get("auth/token/refresh"), 5);
  });
});
