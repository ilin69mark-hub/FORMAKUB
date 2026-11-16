#!/usr/bin/env node
/**
 * Browser smoke via Chrome DevTools Protocol (no extra npm dependencies).
 * Requires: Chrome with --remote-debugging-port, running app + disposable Keycloak.
 * Env: SMOKE_BASE_URL, CHROME_PORT, SMOKE_VIEWER_PASS, SMOKE_ADMIN_PASS, SMOKE_PUBLISHER_PASS.
 */
import { readFileSync } from "node:fs";

const base = process.env.SMOKE_BASE_URL || "http://localhost:3010";
const chromePort = process.env.CHROME_PORT || "9222";
const onlyNoPrice = process.env.SMOKE_ONLY_NO_PRICE === "1";
const KITCHEN_CONFIG = {
  version: 1,
  kind: "kitchen",
  modules: [
    { id: "m-base", type: "base", width: 60, height: 72, depth: 60, shelves: 1, drawers: 0 },
  ],
  bodyMaterial: "mdf",
  bodyFinish: "sand",
  facadeMaterial: "mdf",
  facadeFinish: "graphite",
  facadeStyle: "flat",
  countertop: "ldsp_hpl",
  countertopThickness: 38,
  handle: "profile",
  hinge: "soft",
  pushToOpen: false,
  plinth: true,
  plinthHeight: 10,
  plinthMaterial: "ldsp",
  plinthThickness: 16,
  plinthFinish: "pvc2",
  plinthMount: "clips",
  underCabinetLighting: false,
  lighting: {
    voltage: 24,
    powerPerMeter: 9.6,
    colorTemp: 3000,
    profile: "surface",
    diffuser: "frosted",
    control: "switch",
  },
  supports: { systemId: "standard", maxSpanCm: 60, maxLoadKgPerLeg: 40 },
  sidePanels: 0,
  promoCode: "",
};
const pass = (name) => readFileSync(process.env[name], "utf8");
const viewerPass = pass("SMOKE_VIEWER_PASS");
const adminPass = pass("SMOKE_ADMIN_PASS");
const publisherPass = pass("SMOKE_PUBLISHER_PASS");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const target = await fetch(
  `http://localhost:${chromePort}/json/new?${encodeURIComponent("about:blank")}`,
  { method: "PUT" },
).then((response) => {
  if (!response.ok) throw new Error(`Chrome /json/new: HTTP ${response.status}`);
  return response.json();
});

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});
let nextId = 1;
const pending = new Map();
const eventWaiters = new Map();
const jsErrors = [];

ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  }
  if (message.method) {
    const waiters = eventWaiters.get(message.method);
    if (waiters?.length) {
      const waiter = waiters.shift();
      waiter.resolve(message.params);
    }
  }
  if (message.method === "Runtime.exceptionThrown") {
    jsErrors.push(message.params?.exceptionDetails?.text ?? "JS exception");
  }
  if (message.method === "Log.entryAdded" && message.params?.entry?.level === "error") {
    const text = message.params.entry.text ?? "";
    if (!/401|403|Failed to load resource/.test(text)) jsErrors.push(text);
  }
});

function waitEvent(method, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const waiters = eventWaiters.get(method) ?? [];
    const waiter = {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject,
    };
    const timer = setTimeout(() => {
      const current = eventWaiters.get(method) ?? [];
      const index = current.indexOf(waiter);
      if (index >= 0) current.splice(index, 1);
      reject(new Error(`timeout event ${method}`));
    }, timeoutMs);
    waiters.push(waiter);
    eventWaiters.set(method, waiters);
  });
}

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
  }
  return result.result?.value;
}

async function waitFor(predicate, timeoutMs = 15000, label = "condition") {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (await predicate()) return true;
    } catch {
      // page may be navigating
    }
    await sleep(150);
  }
  throw new Error(`timeout: ${label}`);
}

async function navigate(url) {
  const loaded = waitEvent("Page.loadEventFired", 20000);
  await send("Page.navigate", { url });
  await loaded.catch(() => undefined);
  await waitFor(
    async () => (await evaluate("document.readyState")) === "complete",
    15000,
    `load ${url}`,
  );
}

async function currentUrl() {
  return evaluate("location.href");
}

let compositionClientIp = 1;
async function api(method, path, body) {
  const payload = body === undefined ? "" : JSON.stringify(body);
  const extraHeaders =
    path.includes("/api/admin/compositions") ||
    path.includes("composition-transition")
      ? { "X-Forwarded-For": `198.51.100.${compositionClientIp++}` }
      : {};
  return evaluate(`(async () => {
    const response = await fetch(${JSON.stringify(path)}, {
      method: ${JSON.stringify(method)},
      headers: { "Content-Type": "application/json", "Origin": location.origin, ...${JSON.stringify(extraHeaders)} },
      ${body === undefined ? "" : `body: ${JSON.stringify(payload)},`}
      credentials: "same-origin",
    });
    let json = null;
    try { json = await response.json(); } catch {}
    return { status: response.status, json };
  })()`);
}

async function login(user, password) {
  await send("Network.clearBrowserCookies");
  await navigate(`${base}/admin`);
  await waitFor(
    async () => (await evaluate("Boolean(document.querySelector('#username'))")),
    15000,
    "Keycloak login form",
  );
  await evaluate(`(() => {
    document.querySelector('#username').value = ${JSON.stringify(user)};
    document.querySelector('#password').value = ${JSON.stringify(password)};
    document.querySelector('#kc-form-login').submit();
    return true;
  })()`);
  await waitFor(
    async () => (await currentUrl()).startsWith(`${base}/admin`),
    20000,
    `login ${user}`,
  );
  try {
    await waitFor(
      async () => (await evaluate("document.body.innerText")).toLowerCase().includes("calculation admin"),
      10000,
      "admin shell",
    );
  } catch (error) {
    console.error("LOGIN DEBUG url=", await currentUrl());
    console.error("LOGIN DEBUG body=", (await evaluate("document.body.innerText")).slice(0, 600));
    throw error;
  }
}

async function logout() {
  const loaded = waitEvent("Page.loadEventFired", 20000);
  await evaluate(`(() => {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/api/auth/logout';
    document.body.appendChild(form);
    form.submit();
    return true;
  })()`).catch(() => undefined);
  await loaded.catch(() => undefined);
  await sleep(500);
  const afterLogoutApi = await api("GET", "/api/admin/parameters");
  return { apiStatus: afterLogoutApi.status };
}

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Log.enable");

  if (onlyNoPrice) {
    const noPriceBase = process.env.SMOKE_NO_PRICE_BASE_URL;
    if (!noPriceBase) throw new Error("SMOKE_NO_PRICE_BASE_URL is required");
    await send("Network.clearBrowserCookies");
    await navigate(`${noPriceBase}/configurator/kitchen`);
    await sleep(2500);
    const text = await evaluate("document.body.innerText");
    record("no-price page loads", text.length > 0);
    record("no-price no calculated breakdown", !text.includes("Итого до скидки"));
    record("no-price no fabricated total", !/Ориентировочно\s+\d/.test(text));
    const apiResult = await evaluate(`(async () => {
      const response = await fetch('/api/calculation-inputs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'preview', config: ${JSON.stringify(KITCHEN_CONFIG)} }),
      });
      let json = null; try { json = await response.json(); } catch {}
      return { status: response.status, codes: (json?.issues ?? []).map((issue) => issue.code) };
    })()`);
    record("no-price API 422", apiResult.status === 422, String(apiResult.status));
    record(
      "no-price version unavailable",
      apiResult.codes.includes("ENGINE_CONTRACT_PRICE_VERSION_UNAVAILABLE"),
      apiResult.codes.join(","),
    );
    record("no-price no js errors", jsErrors.length === 0, jsErrors.slice(0, 2).join(" | "));
    const failedNoPrice = results.filter((item) => !item.ok);
    console.log(`\n${results.length - failedNoPrice.length}/${results.length} no-price checks passed`);
    ws.close();
    process.exit(failedNoPrice.length ? 1 : 0);
  }

  // Unauthenticated
  await send("Network.clearBrowserCookies");
  await navigate(`${base}/admin`);
  const unauthUrl = await currentUrl();
  record("admin unauth redirect", !unauthUrl.startsWith(`${base}/admin`), unauthUrl);
  await navigate(`${base}/`);
  const unauthApi = await api("GET", "/api/admin/parameters");
  record("admin api unauth 401", unauthApi.status === 401, String(unauthApi.status));

  // Viewer
  await login("viewer", viewerPass);
  const viewerVersions = await api("GET", "/api/admin/pricing-versions");
  record("viewer read versions", viewerVersions.status === 200, String(viewerVersions.status));
  const published = (viewerVersions.json?.data ?? []).find((v) => v.status === "published");
  const viewerCreate = published
    ? await api("POST", "/api/admin/pricing-versions", { fromVersionId: published.id })
    : { status: 0 };
  record("viewer cannot write", viewerCreate.status === 403, String(viewerCreate.status));
  const viewerLogout = await logout();
  record("viewer logout revokes app session", viewerLogout.apiStatus === 401, String(viewerLogout.apiStatus));
  await navigate(`${base}/admin`);
  const afterLogoutUrl = await currentUrl();
  record("admin redirect after logout", !afterLogoutUrl.startsWith(`${base}/admin`), afterLogoutUrl);

  // Admin
  await login("admin", adminPass);
  const adminVersions = await api("GET", "/api/admin/pricing-versions");
  const published2 = (adminVersions.json?.data ?? []).find((v) => v.status === "published");
  let draft = (adminVersions.json?.data ?? []).find((v) => v.status === "draft");
  if (!draft && published2) {
    const created = await api("POST", "/api/admin/pricing-versions", { fromVersionId: published2.id });
    record("admin creates draft", created.status === 201, String(created.status));
    const after = await api("GET", "/api/admin/pricing-versions");
    draft = (after.json?.data ?? []).find((v) => v.status === "draft");
  } else {
    record("admin creates draft", Boolean(draft), "existing draft");
  }
  if (draft) {
    const adminPublish = await api("POST", `/api/admin/pricing-versions/${draft.id}/publish`, {
      confirmed: true,
      expectedVersion: draft.createdAt,
    });
    record("admin without price.publish cannot publish", adminPublish.status === 403, String(adminPublish.status));
  } else {
    record("admin without price.publish cannot publish", false, "no draft");
  }
  await logout();

  // Publisher
  await login("publisher", publisherPass);
  const publisherVersions = await api("GET", "/api/admin/pricing-versions");
  const publisherDraft = (publisherVersions.json?.data ?? []).find((v) => v.status === "draft");
  if (publisherDraft) {
    const publish = await api("POST", `/api/admin/pricing-versions/${publisherDraft.id}/publish`, {
      confirmed: true,
      expectedVersion: publisherDraft.createdAt,
    });
    record("publisher publishes", publish.status === 200, String(publish.status));
  } else {
    record("publisher publishes", false, "no draft");
  }
  // Composition Admin E2E (real OIDC/RBAC; isolated temp DB)
  await logout();
  await login("admin", adminPass);
  let compositionList = await api("GET", "/api/admin/compositions");
  record(
    "composition list read",
    compositionList.status === 200,
    String(compositionList.status),
  );
  let compositions = compositionList.json?.data ?? [];
  if (compositions.length === 0) {
    const imported = await api("POST", "/api/admin/compositions/import");
    record(
      "composition import draft",
      imported.status === 201 || imported.status === 200,
      String(imported.status),
    );
    compositionList = await api("GET", "/api/admin/compositions");
    compositions = compositionList.json?.data ?? [];
  }
  let compositionDraft = compositions.find((item) => item.status === "draft");
  record("composition draft readable", Boolean(compositionDraft), compositionDraft?.id ?? "none");

  if (compositionDraft) {
    const adminPublish = await api(
      "POST",
      `/api/admin/compositions/${compositionDraft.id}/publish`,
      {
        expectedVersion: compositionDraft.version,
        expectedStateVersion: `${compositionDraft.id}@${compositionDraft.version}`,
        confirmed: true,
        operationId: "smoke-composition-admin-publish",
      },
    );
    record(
      "composition admin without price.publish cannot publish",
      adminPublish.status === 403,
      String(adminPublish.status),
    );

    await logout();
    await login("publisher", publisherPass);
    const preliminaryPublish = await api(
      "POST",
      `/api/admin/compositions/${compositionDraft.id}/publish`,
      {
        expectedVersion: compositionDraft.version,
        expectedStateVersion: `${compositionDraft.id}@${compositionDraft.version}`,
        confirmed: true,
        operationId: "smoke-composition-preliminary",
      },
    );
    record(
      "composition preliminary publish blocked",
      preliminaryPublish.status === 422 || preliminaryPublish.status === 409,
      String(preliminaryPublish.status),
    );

    await logout();
    await login("admin", adminPass);
    const datasheet = await api(
      "PATCH",
      `/api/admin/compositions/${compositionDraft.id}`,
      {
        expectedVersion: compositionDraft.version,
        lines: compositionDraft.lines.map((line) => ({
          ...line,
          source: "datasheet",
          confirmation: undefined,
        })),
      },
    );
    record(
      "composition draft edit",
      datasheet.status === 200,
      String(datasheet.status),
    );
    const updatedDraft = datasheet.json?.data;
    if (updatedDraft) {
      const validate = await api(
        "GET",
        `/api/admin/compositions/${updatedDraft.id}/validate`,
      );
      record(
        "composition validate",
        validate.status === 200 && validate.json?.data?.ok === true,
        JSON.stringify(validate.json?.data?.errors ?? []).slice(0, 200),
      );
      await logout();
      await login("publisher", publisherPass);
      const publish = await api(
        "POST",
        `/api/admin/compositions/${updatedDraft.id}/publish`,
        {
          expectedVersion: updatedDraft.version,
          expectedStateVersion: `${updatedDraft.id}@${updatedDraft.version}`,
          confirmed: true,
          operationId: "smoke-composition-publish",
        },
      );
      record(
        "composition publisher publishes",
        publish.status === 200,
        String(publish.status),
      );
      const published = publish.json?.data;
      if (published) {
        const approve = await api(
          "POST",
          `/api/admin/compositions/${published.id}/production-approval`,
          {
            expectedVersion: published.version,
            confirmed: true,
          },
        );
        record(
          "composition production gate",
          approve.status === 200 && approve.json?.data?.production?.status === "approved",
          String(approve.status),
        );
      }

      await logout();
      await login("admin", adminPass);
      const nextDraftResponse = await api(
        "POST",
        "/api/admin/compositions",
        published ? { sourceVersionId: published.id } : {},
      );
      record(
        "composition create next draft",
        nextDraftResponse.status === 201,
        String(nextDraftResponse.status),
      );
      const nextDraft = nextDraftResponse.json?.data;
      if (nextDraft) {
        await logout();
        await login("publisher", publisherPass);
        const confirmLine = await api(
          "POST",
          `/api/admin/compositions/${nextDraft.id}/confirm`,
          {
            expectedVersion: nextDraft.version,
            lineId: nextDraft.lines[0].id,
            reference: "smoke-owner-confirmation",
            confirmed: true,
          },
        );
        record(
          "composition owner confirmation",
          confirmLine.status === 200,
          String(confirmLine.status),
        );
        const stalePublish = await api(
          "POST",
          `/api/admin/compositions/${nextDraft.id}/publish`,
          {
            expectedVersion: nextDraft.version,
            expectedStateVersion: `${nextDraft.id}@${nextDraft.version}`,
            confirmed: true,
            operationId: "smoke-composition-stale",
          },
        );
        record(
          "composition stale publish blocked",
          stalePublish.status === 409,
          String(stalePublish.status),
        );

        await navigate(`${base}/admin/modules/base`);
        await waitFor(
          async () => (await evaluate("document.body.innerText")).includes("Сохранить draft"),
          10000,
          "composition editor",
        );
        const dirtyResult = await evaluate(`(() => {
          const input = document.querySelector('input[type="number"]');
          if (!input) return "no-input";
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
          setter.call(input, "777");
          input.dispatchEvent(new Event("input", { bubbles: true }));
          const buttons = [...document.querySelectorAll("button")];
          const publish = buttons.find((button) => /Опубликовать/.test(button.textContent || ""));
          if (!publish) return "no-publish-button";
          publish.click();
          return "clicked";
        })()`);
        await sleep(800);
        const dirtyText = await evaluate("document.body.innerText");
        record(
          "composition dirty publish blocked",
          dirtyResult === "clicked" && dirtyText.includes("Сначала сохраните draft"),
          `${dirtyResult}; message=${dirtyText.includes("Сначала сохраните draft")}`,
        );
        record(
          "composition production gate visible",
          dirtyText.includes("Production Gate") || dirtyText.includes("production"),
          "page marker",
        );
      }

      await logout();
      await login("viewer", viewerPass);
      const viewerList = await api("GET", "/api/admin/compositions");
      record(
        "composition viewer read",
        viewerList.status === 200,
        String(viewerList.status),
      );
      if (nextDraft) {
        const viewerPatch = await api(
          "PATCH",
          `/api/admin/compositions/${nextDraft.id}`,
          { expectedVersion: nextDraft.version, notes: "viewer" },
        );
        record(
          "composition viewer cannot edit",
          viewerPatch.status === 403,
          String(viewerPatch.status),
        );
      }
    }
  }

  const audit = await api("GET", "/api/admin/audit-log");
  const denied = (audit.json?.data ?? []).some((event) => event.result === "denied");
  record("denied operation audited", denied, denied ? "found" : "missing");

  // Admin pages
  for (const [path, marker] of [
    ["/admin", "Calculation Admin"],
    ["/admin/prices", "Цены"],
    ["/admin/projects", "пересчёт"],
    ["/admin/modules", "Мебельные модули"],
    ["/admin/modules/base", "Управляемый состав"],
  ]) {
    await navigate(`${base}${path}`);
    const text = await evaluate("document.body.innerText");
    record(`page ${path}`, text.toLowerCase().includes(marker.toLowerCase()), `status ok, marker=${marker}`);
  }
  await logout();

  // Public calculator
  jsErrors.length = 0;
  for (const path of ["/", "/configurator/kitchen", "/configurator/wardrobe"]) {
    await navigate(`${base}${path}`);
    await sleep(2500);
    const text = await evaluate("document.body.innerText");
    record(`public ${path}`, text.includes("₽"), `price text=${text.includes("₽")}`);
  }
  record("public js errors", jsErrors.length === 0, jsErrors.slice(0, 2).join(" | "));

  const failed = results.filter((item) => !item.ok);
  console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`);
  if (failed.length) process.exitCode = 1;
} catch (error) {
  console.error("BROWSER SMOKE ERROR:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  try {
    ws.close();
  } catch {}
}
