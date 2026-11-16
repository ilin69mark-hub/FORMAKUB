#!/usr/bin/env node
/**
 * PASS 7 — browser acceptance driver (CDP, no new deps).
 * Usage: node scripts/acceptance-driver.mjs <baseUrl> <chromePort> <kind>
 * Flow: open → price → save → projectId → reopen → lead → report.
 */
const base = process.argv[2] || "http://localhost:3015";
const chromePort = process.argv[3] || "9333";
const kind = process.argv[4] || "kitchen";

async function cdpTargets() {
  const res = await fetch(`http://localhost:${chromePort}/json/list`);
  return res.json();
}

async function openPage() {
  /* PASS 8: создаём пустой target и навигируемся уже внутри CDP-сессии. */
  const res = await fetch(`http://localhost:${chromePort}/json/new?about:blank`, {
    method: "PUT",
  });
  if (!res.ok) throw new Error(`CDP target create failed: ${res.status}`);
  const target = await res.json();
  if (!target.webSocketDebuggerUrl) {
    throw new Error("CDP target has no webSocketDebuggerUrl");
  }
  return target;
}

class Session {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        this.pending.get(msg.id)(msg);
        this.pending.delete(msg.id);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, (msg) =>
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result),
      );
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression, awaitPromise = false) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise,
    });
    if (result.exceptionDetails) {
      throw new Error(
        `eval failed: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`,
      );
    }
    return result.result?.value;
  }
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP ws connect timeout")), 15000);
    ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener("error", (e) => { clearTimeout(timer); reject(new Error(`CDP ws error: ${e.message ?? "unknown"}`)); }, { once: true });
  });
  return new Session(ws);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(session, expression, timeoutMs = 60000, label = "condition") {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (await session.eval(expression)) return true;
    } catch {
      /* page may be navigating */
    }
    await sleep(500);
  }
  throw new Error(`timeout waiting for ${label}`);
}

function priceFromText(text) {
  const match = text.replace(/\u00a0/g, " ").match(/([\d][\d ]{3,12})\s*₽/);
  return match ? Number(match[1].replace(/ /g, "")) : null;
}

const report = { kind, steps: [], ok: false };

try {
  const page = await openPage();
  report.targetId = page.id;
  const session = await connect(page.webSocketDebuggerUrl);
  await session.send("Page.enable");
  await session.send("Runtime.enable");

  report.url = `${base}/configurator/${kind}`;
  await session.send("Page.navigate", { url: report.url });
  await waitFor(session, "document.readyState === 'complete'", 120000, "document ready");
  report.readyState = await session.eval("document.readyState");
  report.title = await session.eval("document.title");
  report.bodyFound = await session.eval("Boolean(document.body)");
  report.href = await session.eval("location.href");

  await waitFor(
    session,
    "document.querySelectorAll('button').length > 20 && (document.body.innerText.includes('Секция 1') || /(Кухня|Шкаф|Гардероб) по вашим размерам/.test(document.body.innerText))",
    90000,
    "configurator render",
  );
  report.steps.push("open");
  report.constructorButtons = await session.eval("document.querySelectorAll('button').length");
  const shot = await session.send("Page.captureScreenshot", { format: "png" });
  report.screenshotBytes = shot?.data ? shot.data.length : 0;
  if (shot?.data) {
    const fs = await import("node:fs");
    fs.writeFileSync(`${process.cwd()}/artifacts-acceptance-${kind}-open.png`, Buffer.from(shot.data, "base64"));
  }

  /* Ждём гидратацию: цена отрисована. */
  await waitFor(session, "/([\\d][\\d ]{3,12})\\s*₽/.test(document.body.innerText)", 60000, "price");
  const priceBefore = priceFromText(await session.eval("document.body.innerText"));
  report.priceBefore = priceBefore;

  /* Изменение параметра: увеличиваем число модулей через кнопку «+». */
  const counter = "(() => { const m = document.body.innerText.match(/(\\d+)\\s*\\/\\s*\\d+/); return m ? Number(m[1]) : null; })()";
  report.modulesBefore = await session.eval(counter);
  const changed = await session.eval(`(() => {
    const log = [];
    const add = [...document.querySelectorAll('button')].find((x) => /^Добавить (модуль|секцию|полку|штанг)/.test(x.textContent.trim()) && !x.disabled);
    if (!add) return { clicked: false, log: ['no add button'] };
    add.click();
    log.push('add clicked');
    return { clicked: true, log };
  })()`);
  await sleep(800);
  /* Если счётчик не изменился — выбираем тип модуля в появившейся панели. */
  let modulesNow = await session.eval(counter);
  if (modulesNow === report.modulesBefore) {
    const typeClick = await session.eval(`(() => {
      const names = ['Мойка','Варочная','Ящики','Пенал','Верх','Бутыльница','Духовой'];
      const candidates = [...document.querySelectorAll('button, [role=button]')].filter((x) => {
        const t = x.textContent.trim();
        return names.some((n) => t === n || t.startsWith(n)) && !x.disabled;
      });
      if (candidates.length === 0) return { clicked: false, count: 0 };
      candidates[candidates.length - 1].click();
      return { clicked: true, count: candidates.length, text: candidates[candidates.length - 1].textContent.trim() };
    })()`);
    report.typeClick = typeClick;
    await sleep(1500);
  }
  report.steps.push(`param-change:${changed}`);
  await sleep(2500);
  report.modulesAfter = await session.eval(
    "(() => { const m = document.body.innerText.match(/(\\d+)\\s*\\/\\s*25/); return m ? Number(m[1]) : null; })()",
  );
  const priceAfter = priceFromText(await session.eval("document.body.innerText"));
  report.priceAfter = priceAfter;
  report.priceChanged = priceBefore !== null && priceAfter !== null && priceBefore !== priceAfter;

  /* Сохранение. */
  const saved = await session.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /Сохранить проект|Сохранить и получить ссылку/.test(x.textContent));
    if (!b || b.disabled) return false;
    b.click();
    return true;
  })()`);
  report.steps.push(`save-clicked:${saved}`);

  let projectId = null;
  const started = Date.now();
  while (Date.now() - started < 60000) {
    projectId = await session.eval(`(() => {
      const m = document.body.innerHTML.match(/\\?project=([a-z0-9]{8})/);
      return m ? m[1] : null;
    })()`);
    if (projectId) break;
    await sleep(500);
  }
  report.projectId = projectId;
  report.steps.push(`projectId:${projectId ?? "null"}`);

  if (projectId) {
    await session.send("Page.navigate", {
      url: `${base}/configurator/${kind}?project=${projectId}`,
    });
    await waitFor(
      session,
      "document.querySelectorAll('button').length > 20 && (document.body.innerText.includes('Секция 1') || document.body.innerText.includes('Кухня по вашим размерам'))",
      120000,
      "reopen render",
    );
    await sleep(2000);
    report.reopened = true;
    report.reopenPrice = priceFromText(await session.eval("document.body.innerText"));
    report.reopenUrl = await session.eval("location.href");
    report.steps.push("reopen");
  }

  /* Заявка: открыть модалку и заполнить. */
  let leadOpened = false;
  let leadAttempts = 0;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    leadOpened = await session.eval(`(() => {
      const els = [...document.querySelectorAll('button')].filter((x) => {
        const t = x.textContent.trim();
        return (t === 'Заявка' || t === 'Отправить заявку' || t === 'Оставить заявку' || t === 'Получить расчёт') && !x.disabled;
      });
      if (els.length === 0) return false;
      const el = els[INDEX];
      if (!el) return false;
      el.click();
      return true;
    })()`.replace("INDEX", String(attempt)));
    leadAttempts += 1;
    await sleep(1200);
    const hasForm = await session.eval("Boolean(document.querySelector('#lead-name'))");
    if (hasForm) break;
  }
  report.steps.push(`lead-open:${leadOpened}:attempts:${leadAttempts}`);
  report.leadFormVisible = await session.eval("Boolean(document.querySelector('#lead-name'))");
  if (!report.leadFormVisible) {
    report.failLeadButtons = await session.eval(
      "[...document.querySelectorAll('button,a')].map((x) => x.textContent.trim()).filter((t) => t && t.length < 30).slice(0, 40)",
    );
  }
  await waitFor(session, "Boolean(document.querySelector('#lead-name'))", 30000, "lead form");

  const filled = await session.eval(`(() => {
    const set = (id, value) => {
      const el = document.querySelector('#' + id);
      if (!el) return false;
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };
    const name = set('lead-name', 'Acceptance Тест');
    const contact = set('lead-contact', '+79990001234');
    const email = document.querySelector('#lead-email') ? set('lead-email', 'acceptance@test.local') : true;
    const consent = document.querySelector('input[type=checkbox]');
    if (consent && !consent.checked) consent.click();
    return { name, contact, email };
  })()`);
  report.steps.push(`lead-fill:${JSON.stringify(filled)}`);
  await sleep(800);

  const submitted = await session.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /Отправить заявку|Отправить/.test(x.textContent) && !x.disabled);
    if (!b) return false;
    b.click();
    return true;
  })()`);
  report.steps.push(`lead-submit:${submitted}`);

  let leadOk = false;
  const leadStart = Date.now();
  while (Date.now() - leadStart < 45000) {
    leadOk = await session.eval(
      "document.body.innerText.includes('Заявка сохранена')",
    );
    if (leadOk) break;
    await sleep(500);
  }
  report.leadSubmitted = leadOk;
  if (leadOk) {
    report.leadId = await session.eval(
      "(() => { const m = document.body.innerText.match(/Номер заявки:\\s*([A-Z0-9-]+)/); return m ? m[1] : null; })()",
    );
  }
  report.steps.push(`lead-success:${leadOk}:${report.leadId ?? "no-id"}`);
  try {
    const fs = await import("node:fs");
    const finalShot = await session.send("Page.captureScreenshot", { format: "png" });
    if (finalShot?.data) {
      fs.writeFileSync(
        `${process.cwd()}/artifacts-acceptance-${kind}-final.png`,
        Buffer.from(finalShot.data, "base64"),
      );
    }
  } catch {}

  report.ok = Boolean(projectId) && report.reopened === true && leadOk === true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  try {
    const page2 = report.targetId
      ? (await cdpTargets()).find((t) => t.id === report.targetId)
      : undefined;
    if (page2) {
      const s2 = await connect(page2.webSocketDebuggerUrl);
      await s2.send("Runtime.enable");
      report.failBodyText = String(
        await s2.eval("document.body ? document.body.innerText.slice(0, 1200) : null"),
      );
      report.failButtons = await s2.eval("document.querySelectorAll('button').length");
      report.failHtmlHead = String(
        await s2.eval("document.body ? document.body.innerHTML.slice(0, 600) : null"),
      );
      const shot = await s2.send("Page.captureScreenshot", { format: "png" });
      report.screenshotBytes = shot?.data ? shot.data.length : 0;
    }
  } catch (e) {
    report.diagnosticsError = e instanceof Error ? e.message : String(e);
  }
}

{
  const fs = await import("node:fs");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.writeFileSync(
    `${process.cwd()}/artifacts-acceptance-${kind}-${stamp}.json`,
    JSON.stringify(report, null, 2),
  );
}
console.log("ACCEPTANCE_RESULT", JSON.stringify(report));
process.exit(report.ok ? 0 : 1);
