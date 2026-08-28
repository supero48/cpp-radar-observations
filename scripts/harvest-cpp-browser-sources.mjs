#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const registryPath = process.env.VZI_CPP_BROWSER_REGISTRY || "config/cpp-browser-sources.json";
const registryBody = fs.readFileSync(registryPath, "utf8");
const registry = JSON.parse(registryBody);
const registryCanonical = JSON.stringify(registry);
const manifestPath = process.env.VZI_CPP_BROWSER_MANIFEST || "build/cpp-browser-observations.json";
const userAgent =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
  "Chrome/150.0.0.0 Safari/537.36 VZICourseRadar/0.1.13 (+https://vozniski-izpit.com/)";
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const slovenianMonths = new Map([
  ["januar", 1], ["januarja", 1], ["jan", 1],
  ["februar", 2], ["februarja", 2], ["feb", 2],
  ["marec", 3], ["marca", 3], ["mar", 3],
  ["april", 4], ["aprila", 4], ["apr", 4],
  ["maj", 5], ["maja", 5],
  ["junij", 6], ["junija", 6], ["jun", 6],
  ["julij", 7], ["julija", 7], ["jul", 7],
  ["avgust", 8], ["avgusta", 8], ["avg", 8],
  ["september", 9], ["septembra", 9], ["sep", 9], ["sept", 9],
  ["oktober", 10], ["oktobra", 10], ["okt", 10],
  ["november", 11], ["novembra", 11], ["nov", 11],
  ["december", 12], ["decembra", 12], ["dec", 12]
]);

function monthNumber(value) {
  return slovenianMonths.get(String(value).trim().toLocaleLowerCase("sl-SI").replace(/\.$/, "")) || null;
}

function isoDate(year, month, day) {
  const value = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (value.getUTCFullYear() !== Number(year) || value.getUTCMonth() !== Number(month) - 1 || value.getUTCDate() !== Number(day)) {
    return null;
  }
  return `${Number(year)}-${String(Number(month)).padStart(2, "0")}-${String(Number(day)).padStart(2, "0")}`;
}

function canonicalDateRange(value) {
  const text = String(value).replace(/\s+/g, " ").trim();
  const namedRange = text.match(/\b(\d{1,2})\.\s*([\p{L}.]+)\s*[–—-]\s*(\d{1,2})\.\s*([\p{L}.]+)\s*(20\d{2})\b/iu);
  if (namedRange) {
    const startMonth = monthNumber(namedRange[2]);
    const endMonth = monthNumber(namedRange[4]);
    if (startMonth && endMonth) {
      const startDate = isoDate(namedRange[5], startMonth, namedRange[1]);
      const endDate = isoDate(namedRange[5], endMonth, namedRange[3]);
      if (startDate && endDate) return { startDate, endDate };
    }
  }
  const namedDate = text.match(/\b(\d{1,2})\.\s*([\p{L}.]+)\s*(20\d{2})\b/iu);
  if (namedDate) {
    const month = monthNumber(namedDate[2]);
    const startDate = month ? isoDate(namedDate[3], month, namedDate[1]) : null;
    if (startDate) return { startDate, endDate: null };
  }
  const numericDate = text.match(/\b(\d{1,2})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(20\d{2})\b/u);
  if (numericDate) {
    const startDate = isoDate(numericDate[3], numericDate[2], numericDate[1]);
    if (startDate) return { startDate, endDate: null };
  }
  return null;
}

function canonicalTimeRange(value) {
  const match = String(value).match(/\b(\d{1,2})[:.](\d{2})\s*[–—-]\s*(\d{1,2})[:.](\d{2})\b/u);
  if (match) {
    const values = match.slice(1).map(Number);
    if (values[0] > 23 || values[1] > 59 || values[2] > 23 || values[3] > 59) return { startTime: null, endTime: null };
    return {
      startTime: `${String(values[0]).padStart(2, "0")}:${String(values[1]).padStart(2, "0")}:00`,
      endTime: `${String(values[2]).padStart(2, "0")}:${String(values[3]).padStart(2, "0")}:00`
    };
  }
  const single = String(value).match(/\bob\s*(\d{1,2})[:.](\d{2})\b/iu);
  if (!single || Number(single[1]) > 23 || Number(single[2]) > 59) return { startTime: null, endTime: null };
  return {
    startTime: `${String(Number(single[1])).padStart(2, "0")}:${String(Number(single[2])).padStart(2, "0")}:00`,
    endTime: null
  };
}

function canonicalLocation(value) {
  const text = String(value).replace(/\s+/g, " ").trim();
  const timed = text.match(/([A-ZČŠŽ][\p{L}.'-]+\s+(?:ulica|cesta|trg|pot)\s+\d+[a-z]?,\s*[A-ZČŠŽ][\p{L} .'-]{1,60})\s*[·|]\s*\d{1,2}[:.]\d{2}/iu);
  if (timed) {
    const name = timed[1].replace(/\s+/g, " ").trim();
    const separator = name.lastIndexOf(",");
    return {
      name,
      streetAddress: separator > 0 ? name.slice(0, separator).trim() : name,
      addressLocality: separator > 0 ? name.slice(separator + 1).trim() : ""
    };
  }
  const inline = text.match(/\b((?:(?:Ulica|Cesta|Trg|Pot)\s+[A-ZČŠŽ][\p{L}.'-]+(?:\s+[\p{L}.'-]+){0,4}|[A-ZČŠŽ][\p{L}.'-]+(?:\s+[\p{L}.'-]+){0,4}\s+(?:ulica|cesta|trg|pot))\s+\d+[a-z]?),\s*(?:\d{4}\s+)?([A-ZČŠŽ][\p{L}.'-]+(?:\s+[\p{L}.'-]+){0,2})/iu);
  if (!inline) return null;
  const streetAddress = inline[1].replace(/\s+/g, " ").trim();
  const addressLocality = inline[2].replace(/\s+/g, " ").trim();
  return {
    name: `${streetAddress}, ${addressLocality}`,
    streetAddress,
    addressLocality
  };
}

function isUnavailableTerm(value) {
  return /\b(?:termin\s+(?:je\s+)?poln|razprodano|zapolnjen[ao]?|ni\s+(?:ve\u010d\s+)?prostih\s+mest)\b/iu.test(String(value));
}

function dateNodePayloadItem(item) {
  const text = String(item.text);
  const dates = canonicalDateRange(text);
  if (!dates) return null;
  return {
    text,
    dates,
    times: canonicalTimeRange(text),
    location: canonicalLocation(text),
    courseType: /\bdodatni\s+del\b/iu.test(text) ? "CPP_ADDITIONAL" : "CPP_GENERAL",
    categoryText: "",
    mode: /\bna\s+daljavo\b/iu.test(text) ? "ONLINE" : null
  };
}

function titleCaseLocality(value) {
  const minorWords = new Set(["na", "ob", "pri", "v"]);
  return String(value)
    .replace(/^PE\s+/iu, "")
    .trim()
    .toLocaleLowerCase("sl-SI")
    .split(/(\s+|-)/u)
    .map((part, index) => {
      if (!part.trim() || part === "-") return part;
      if (index > 0 && minorWords.has(part)) return part;
      return part.charAt(0).toLocaleUpperCase("sl-SI") + part.slice(1);
    })
    .join("");
}

function relaxPayloadItem(item) {
  const url = new URL(String(item.href));
  const typeMatch = url.pathname.match(/\/tip=(1|2)\/c=\1(?:\/|$)/u);
  const termMatch = url.pathname.match(/\/termin=(\d+)\/enota=(\d+)\/tip=(1|2)\/c=\3(?:\/|$)/u);
  if (!typeMatch || !termMatch) return null;
  const dates = canonicalDateRange(item.text);
  if (!dates) return null;
  const courseType = typeMatch[1] === "2" ? "CPP_ADDITIONAL" : "CPP_GENERAL";
  const mode = /\/nadaljavo=1(?:\/|$)/u.test(url.pathname) || /\bNA DALJAVO\b/iu.test(item.text) ? "ONLINE" : "CLASSROOM";
  const locality = titleCaseLocality(item.branch || url.pathname.match(/\/poslovne-enote\/([^/]+)/u)?.[1]?.replace(/-/g, " ") || "");
  const categoryText = courseType === "CPP_ADDITIONAL"
    ? String(item.text).replace(/^.*?\bob\s*\d{1,2}[:.]\d{2}\s*/iu, "").replace(/\s+NA DALJAVO\b.*$/iu, "").replace(/\s+PRIJAVA\b.*$/iu, "").trim()
    : "";
  return {
    text: String(item.text),
    dates,
    times: canonicalTimeRange(item.text),
    location: locality ? {
      name: mode === "ONLINE" ? `Na daljavo — PE ${locality}` : `PE ${locality}`,
      streetAddress: "",
      addressLocality: locality
    } : null,
    sourceEventId: `relax-${termMatch[1]}-${termMatch[2]}-${termMatch[3]}`,
    registrationUrl: url.href,
    courseType,
    categoryText,
    mode
  };
}

function validateRegistry(value) {
  const failures = [];
  if (value?.version !== 1) failures.push("registry version must be 1");
  if (!Array.isArray(value?.sources) || value.sources.length === 0) {
    failures.push("registry must contain at least one source");
  }
  const identities = new Set();
  for (const [index, source] of (value?.sources || []).entries()) {
    const prefix = `sources[${index}]`;
    if (!Number.isInteger(source.school_id) || source.school_id <= 0) failures.push(`${prefix}.school_id is invalid`);
    if (typeof source.school_name !== "string" || !source.school_name.trim()) failures.push(`${prefix}.school_name is required`);
    let parsed;
    try {
      parsed = new URL(source.url);
    } catch {
      failures.push(`${prefix}.url is invalid`);
    }
    if (parsed && parsed.protocol !== "https:") failures.push(`${prefix}.url must use HTTPS`);
    if (!Array.isArray(source.selectors) || source.selectors.length < 1 || source.selectors.length > 8) {
      failures.push(`${prefix}.selectors must contain 1-8 selectors`);
    } else if (source.selectors.some((selector) => typeof selector !== "string" || !selector.trim() || selector.length > 160)) {
      failures.push(`${prefix}.selectors contains an invalid selector`);
    }
    if (typeof source.context_text !== "string" || !/cpp|cestno/i.test(source.context_text)) {
      failures.push(`${prefix}.context_text must identify CPP context`);
    }
    if (!Number.isInteger(source.max_nodes) || source.max_nodes < 1 || source.max_nodes > 100) {
      failures.push(`${prefix}.max_nodes must be between 1 and 100`);
    }
    if (!['date-nodes-v1', 'relax-registration-v1', 'tilia-course-v1'].includes(source.extractor || 'date-nodes-v1')) {
      failures.push(`${prefix}.extractor is not approved`);
    }
    if (typeof source.domain !== "string" || !source.domain.trim()) failures.push(`${prefix}.domain is required`);
    if (typeof source.homepage_url !== "string") failures.push(`${prefix}.homepage_url is required`);
    if (typeof source.approved !== "boolean" || typeof source.enabled !== "boolean") {
      failures.push(`${prefix}.approved and ${prefix}.enabled must be explicit booleans`);
    }
    const identity = `${source.school_id}|${source.url}`;
    if (identities.has(identity)) failures.push(`${prefix} duplicates an existing source`);
    identities.add(identity);
  }
  if (failures.length) throw new Error(`Invalid browser source registry:\n- ${failures.join("\n- ")}`);
}

function positiveInteger(value, fallback, name) {
  if (value === undefined || value === null || value === "") return fallback;
  if (!/^\d+$/u.test(String(value)) || Number(value) < 1 || Number(value) > 1000) {
    throw new Error(`${name} must be an integer between 1 and 1000`);
  }
  return Number(value);
}

function nonNegativeInteger(value, fallback, name) {
  if (value === undefined || value === null || value === "") return fallback;
  if (!/^\d+$/u.test(String(value))) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return Number(value);
}

function selectHarvestBatch(sources, maxSources, rotationSlot) {
  const eligible = sources.filter((source) => source.approved && source.enabled);
  if (eligible.length === 0) throw new Error("Registry contains no approved and enabled browser sources");
  const selectedCount = Math.min(maxSources, eligible.length);
  const startIndex = eligible.length <= maxSources ? 0 : (rotationSlot * maxSources) % eligible.length;
  const selected = Array.from(
    { length: selectedCount },
    (_, offset) => eligible[(startIndex + offset) % eligible.length]
  );
  return {
    selected,
    totalEligible: eligible.length,
    maxSources,
    rotationSlot,
    startIndex
  };
}

function manifestSignatureMessage(manifest) {
  const version = Number(manifest.version || 1);
  const lines = [
    `vzi-cpp-browser-manifest-v${version}`,
    String(manifest.generated_at),
    String(manifest.registry_sha256),
    String(manifest.observations.length)
  ];
  for (const observation of manifest.observations) {
    lines.push(
      String(observation.school_id),
      String(observation.source_url),
      String(observation.observed_at),
      String(observation.content_sha256)
    );
  }
  return lines.join("\n");
}

validateRegistry(registry);
if (process.argv.includes("--self-test")) {
  const firstRange = canonicalDateRange("23. sep. – 29. sep. 2026 Termin poln");
  const secondRange = canonicalDateRange("15. okt. – 21. okt. 2026");
  const singleDate = canonicalDateRange("2. 9. 2026");
  const times = canonicalTimeRange("Cafova ulica 5, Maribor · 16:00–19:15");
  const singleTime = canonicalTimeRange("27. 8. 2026 ob 16.00 PRIJAVA");
  const location = canonicalLocation("15. okt. – 21. okt. 2026 Cafova ulica 5, Maribor · 16:00–19:15");
  const leadingStreetLocation = canonicalLocation("Ponedeljek, 7. September 2026 Cesta Staneta Žagarja 27a, 4000 Kranj");
  const labelledLocation = canonicalLocation("21.9.2026 (lokacija: Zagrebška cesta 25, 2000 Maribor, Datumi: 21. in 22. september)");
  const relaxGeneral = relaxPayloadItem({
    text: "08. 9. 2026 ob 16.00 PRIJAVA",
    branch: "PE MARIBOR",
    href: "https://solavoznje-relax.si/sl/poslovne-enote/pe-maribor/termin=1161/enota=5/tip=1/c=1"
  });
  const relaxAdditional = relaxPayloadItem({
    text: "10. 9. 2026 ob 16.00 A1, A2, A NA DALJAVO PRIJAVA",
    branch: "PE SLOVENJ GRADEC",
    href: "https://solavoznje-relax.si/sl/poslovne-enote/pe-slovenj-gradec/termin=1141/enota=17/tip=2/c=2/nadaljavo=1"
  });
  const relaxRejected = relaxPayloadItem({
    text: "08. 9. 2026 ob 17.00 PRIJAVA",
    branch: "PE MUTA",
    href: "https://solavoznje-relax.si/sl/poslovne-enote/pe-muta/termin=531/enota=8/tip=3/c=3"
  });
  const dateNodeAdditional = dateNodePayloadItem({
    text: "Sreda, 23.09.2026 Začetek ob 18:00 Tečaj CPP dodatni del A"
  });
  const tiliaCourse = dateNodePayloadItem({
    text: "21.9.2026 (September) - B kategorija Vsi tečaji se začnejo v ponedeljek ob 17:00"
  });
  const signatureFixture = {
    version: 2,
    generated_at: "2026-08-26T19:21:06.283Z",
    registry,
    registry_sha256: "a".repeat(64),
    observations: [{
      school_id: 3103,
      source_url: "https://modrivoznik.si/avtosola/maribor",
      observed_at: "2026-08-26T19:20:57.470Z",
      content_sha256: "b".repeat(64)
    }]
  };
  const signatureKeys = crypto.generateKeyPairSync("ed25519");
  const fixtureMessage = Buffer.from(manifestSignatureMessage(signatureFixture), "utf8");
  const fixtureSignature = crypto.sign(null, fixtureMessage, signatureKeys.privateKey);
  const rotationSources = Array.from({ length: 45 }, (_, index) => ({
    school_id: index + 1,
    approved: true,
    enabled: true
  }));
  const firstBatch = selectHarvestBatch(rotationSources, 20, 0);
  const secondBatch = selectHarvestBatch(rotationSources, 20, 1);
  const thirdBatch = selectHarvestBatch(rotationSources, 20, 2);
  const rotationCoverage = new Set([
    ...firstBatch.selected,
    ...secondBatch.selected,
    ...thirdBatch.selected
  ].map((source) => source.school_id));
  const filteredBatch = selectHarvestBatch([
    { school_id: 1, approved: true, enabled: true },
    { school_id: 2, approved: false, enabled: true },
    { school_id: 3, approved: true, enabled: false }
  ], 20, 0);
  const checks = [
    firstRange?.startDate === "2026-09-23" && firstRange?.endDate === "2026-09-29",
    secondRange?.startDate === "2026-10-15" && secondRange?.endDate === "2026-10-21",
    singleDate?.startDate === "2026-09-02" && singleDate?.endDate === null,
    times.startTime === "16:00:00" && times.endTime === "19:15:00",
    singleTime.startTime === "16:00:00" && singleTime.endTime === null,
    location?.name === "Cafova ulica 5, Maribor" && location?.addressLocality === "Maribor",
    leadingStreetLocation?.name === "Cesta Staneta Žagarja 27a, Kranj" && leadingStreetLocation?.addressLocality === "Kranj",
    labelledLocation?.name === "Zagrebška cesta 25, Maribor" && labelledLocation?.addressLocality === "Maribor",
    isUnavailableTerm("23. sep. – 29. sep. 2026 Termin poln"),
    isUnavailableTerm("Četrtek, 03. 09. 2026 Začetek ob 18:00 Ni več prostih mest"),
    !isUnavailableTerm("15. okt. – 21. okt. 2026"),
    relaxGeneral?.courseType === "CPP_GENERAL" && relaxGeneral?.location?.addressLocality === "Maribor",
    relaxAdditional?.courseType === "CPP_ADDITIONAL" && relaxAdditional?.mode === "ONLINE" && relaxAdditional?.categoryText === "A1, A2, A",
    relaxRejected === null,
    dateNodeAdditional?.courseType === "CPP_ADDITIONAL" && dateNodeAdditional?.dates.startDate === "2026-09-23",
    tiliaCourse?.dates.startDate === "2026-09-21" && tiliaCourse?.times.startTime === "17:00:00",
    crypto.verify(null, fixtureMessage, signatureKeys.publicKey, fixtureSignature),
    manifestSignatureMessage(signatureFixture).startsWith("vzi-cpp-browser-manifest-v2\n"),
    signatureFixture.registry === registry,
    firstBatch.selected.map((source) => source.school_id).join(",") === Array.from({ length: 20 }, (_, index) => index + 1).join(","),
    secondBatch.selected.map((source) => source.school_id).join(",") === Array.from({ length: 20 }, (_, index) => index + 21).join(","),
    thirdBatch.selected.map((source) => source.school_id).join(",") === [...Array.from({ length: 5 }, (_, index) => index + 41), ...Array.from({ length: 15 }, (_, index) => index + 1)].join(","),
    rotationCoverage.size === 45,
    filteredBatch.totalEligible === 1 && filteredBatch.selected[0]?.school_id === 1,
    positiveInteger("20", 10, "test") === 20,
    nonNegativeInteger("0", 5, "test") === 0
  ];
  if (checks.some((passed) => !passed)) throw new Error("Browser structured-event self-test failed");
  process.stdout.write(`Browser structured-event self-test PASS: ${checks.length} checks.\n`);
  process.exit(0);
}
if (process.argv.includes("--validate-only")) {
  process.stdout.write(`Browser source registry PASS: ${registry.sources.length} approved source(s).\n`);
  process.exit(0);
}

function chromeBinary() {
  if (process.env.VZI_CHROME_BIN && fs.existsSync(process.env.VZI_CHROME_BIN)) return process.env.VZI_CHROME_BIN;
  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].find((candidate) => fs.existsSync(candidate));
}

async function createCdpClient(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Chrome CDP connection timed out")), 10000);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("Chrome CDP connection failed"));
    }, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const task = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) task.reject(new Error(`Chrome CDP error: ${JSON.stringify(message.error)}`));
    else task.resolve(message.result || {});
  });
  return {
    call(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      socket.close();
    }
  };
}

async function startChrome() {
  const executable = chromeBinary();
  if (!executable) throw new Error("Chrome is unavailable on the runner");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "vzi-cpp-harvest-"));
  const port = 20000 + crypto.randomInt(20000);
  const child = spawn(executable, [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-extensions",
    `--remote-debugging-address=127.0.0.1`,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "about:blank"
  ], { stdio: "ignore" });

  let version;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        version = await response.json();
        break;
      }
    } catch {
      // Chrome is still starting.
    }
    await wait(250);
  }
  if (!version?.webSocketDebuggerUrl) throw new Error("Chrome did not expose a local CDP endpoint");
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((target) => target.type === "page");
  if (!page?.webSocketDebuggerUrl) throw new Error("Chrome did not expose a page target");
  const cdp = await createCdpClient(page.webSocketDebuggerUrl);
  await cdp.call("Page.enable");
  await cdp.call("Runtime.enable");
  await cdp.call("Network.enable");
  await cdp.call("Emulation.setUserAgentOverride", { userAgent, acceptLanguage: "sl-SI,sl;q=0.9,en;q=0.8" });
  return { cdp, child, profile };
}

function robotsAllows(body, pathName) {
  const groups = new Map();
  let agents = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/\s*#.*$/, "").trim();
    if (!line || !line.includes(":")) continue;
    const separator = line.indexOf(":");
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === "user-agent") {
      const agent = value.toLowerCase();
      agents = [agent];
      if (!groups.has(agent)) groups.set(agent, []);
    } else if ((field === "allow" || field === "disallow") && agents.length) {
      for (const agent of agents) groups.get(agent).push({ field, path: value });
    }
  }
  const rules = [...(groups.get("vzicourseradar") || []), ...(groups.get("*") || [])];
  let allowed = true;
  let longest = -1;
  for (const rule of rules) {
    const prefix = rule.path.replace(/\*.*$/, "");
    if (!prefix || !pathName.startsWith(prefix)) continue;
    if (rule.path.length >= longest) {
      longest = rule.path.length;
      allowed = rule.field === "allow";
    }
  }
  return allowed;
}

async function assertRobotsAllowed(source) {
  const url = new URL(source.url);
  const robotsUrl = new URL("/robots.txt", url);
  let response;
  try {
    response = await fetch(robotsUrl, { headers: { "User-Agent": userAgent, "Accept": "text/plain" }, signal: AbortSignal.timeout(10000) });
  } catch {
    return;
  }
  if (response.status === 404) return;
  if (!response.ok) return;
  if (!robotsAllows(await response.text(), `${url.pathname}${url.search}`)) {
    throw new Error(`robots.txt disallows ${source.school_name}`);
  }
}

async function evaluate(cdp, expression) {
  const result = await cdp.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Chrome evaluation failed");
  return result.result?.value;
}

async function navigate(cdp, url, settleMilliseconds = 3000) {
  await cdp.call("Page.navigate", { url });
  await wait(settleMilliseconds);
}

async function harvestSource(cdp, source) {
  await assertRobotsAllowed(source);
  await navigate(cdp, source.url, 3500);
  const expression = `(() => {
    const selectors = ${JSON.stringify(source.selectors)};
    const maxNodes = ${source.max_nodes};
    const extractor = ${JSON.stringify(source.extractor || 'date-nodes-v1')};
    const named = /\\b\\d{1,2}\\.\\s*(?:jan|feb|mar|apr|maj|jun|jul|avg|sep|okt|nov|dec)[a-zč]*\\.?\\s*[–—-]\\s*\\d{1,2}\\./iu;
    const numeric = /\\b\\d{1,2}\\s*[.\\/-]\\s*\\d{1,2}\\s*[.\\/-]\\s*20\\d{2}\\b/u;
    const found = [];
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        let text = (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
        let item = { text };
        if (extractor === 'relax-registration-v1') {
          const href = node instanceof HTMLAnchorElement ? node.href : '';
          if (!/\\/tip=(1|2)\\/c=\\1(?:\\/|$)/u.test(new URL(href, document.baseURI).pathname)) continue;
          const eventNode = node.closest('.post-thumbnail-content');
          const branchNode = node.closest('.comment')?.querySelector('a:not([href*="/termin="])');
          text = (eventNode?.innerText || '').replace(/\\s+/g, ' ').trim();
          item = { text, href: new URL(href, document.baseURI).href, branch: (branchNode?.innerText || '').replace(/\\s+/g, ' ').trim() };
        } else if (extractor === 'tilia-course-v1') {
          const prompt = node.closest('#nf-field-15-wrap')?.querySelector('.nf-field-label')?.innerText || '';
          text = [text, prompt].join(' ').replace(/\\s+/g, ' ').trim();
          item = { text };
        }
        if (!text || text.length > 800 || (!named.test(text) && !numeric.test(text))) continue;
        if (!found.some((existing) => (item.href || item.text) === (existing.href || existing.text))) found.push(item);
        if (found.length >= maxNodes) break;
      }
      if (found.length >= maxNodes) break;
    }
    return { title: document.title, items: found };
  })()`;
  let result = await evaluate(cdp, expression);
  for (let attempt = 0; result?.items?.length === 0 && attempt < 8; attempt += 1) {
    await wait(1000);
    result = await evaluate(cdp, expression);
  }
  if (!Array.isArray(result?.items) || result.items.length === 0) {
    throw new Error(`${source.school_name}: rendered page contained no date-bearing approved nodes`);
  }
  const availableItems = result.items.filter((item) => !isUnavailableTerm(item.text));
  if (availableItems.length === 0) {
    throw new Error(`${source.school_name}: rendered page contained only unavailable terms`);
  }
  const payloadItems = availableItems.map((item) => source.extractor === 'relax-registration-v1'
    ? relaxPayloadItem(item)
    : dateNodePayloadItem(item))
    .filter((item) => item !== null && item.dates !== null);
  if (payloadItems.length === 0) {
    throw new Error(`${source.school_name}: rendered date-bearing nodes could not be normalized`);
  }
  const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
  const events = payloadItems.map((item) => {
    const courseLabel = item.courseType === 'CPP_ADDITIONAL' ? 'Dodatni del tečaja CPP' : 'Splošni del tečaja CPP';
    const categoryLabel = item.categoryText ? ` Kategorije: ${item.categoryText}.` : '';
    const modeLabel = item.mode === 'ONLINE' ? ' Izvedba na daljavo.' : item.mode === 'CLASSROOM' ? ' Izvedba v prostorih poslovalnice.' : '';
    const event = {
      "@context": "https://schema.org",
      "@type": "EducationEvent",
      "@id": item.sourceEventId ? `${source.url}#${item.sourceEventId}` : `${source.url}#vzi-browser-${crypto.createHash("sha256").update(item.text).digest("hex").slice(0, 16)}`,
      name: `${courseLabel} — ${source.school_name}`,
      description: `${item.text}.${categoryLabel}${modeLabel}`.replace(/\\s+/g, ' ').trim(),
      startDate: item.dates.startDate + (item.times.startTime ? `T${item.times.startTime}` : ""),
      url: source.url,
      inLanguage: "sl"
    };
    if (item.registrationUrl) {
      event.offers = { "@type": "Offer", url: item.registrationUrl, availability: "https://schema.org/InStock" };
    }
    if (item.dates.endDate) {
      event.endDate = item.dates.endDate + (item.times.endTime ? `T${item.times.endTime}` : "");
    }
    if (item.location) {
      event.location = {
        "@type": "Place",
        name: item.location.name,
        address: {
          "@type": "PostalAddress",
          streetAddress: item.location.streetAddress || undefined,
          addressLocality: item.location.addressLocality,
          addressCountry: "SI"
        }
      };
    }
    return event;
  });
  const jsonLd = JSON.stringify(events).replace(/&/g, "\\u0026").replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
  const html = "<!doctype html><html lang=\"sl\"><head><meta charset=\"utf-8\"><title>" +
    escape(result.title || source.school_name) + "</title><script type=\"application/ld+json\">" +
    jsonLd + "</script></head><body><main><h1>" +
    escape(source.context_text) + "</h1></main></body></html>";
  return { html, nodeCount: payloadItems.length, skippedUnavailable: result.items.length - availableItems.length };
}

const runtime = await startChrome();
const results = [];
const observations = [];
const maxSources = positiveInteger(process.env.VZI_CPP_MAX_SOURCES_PER_RUN, 20, "VZI_CPP_MAX_SOURCES_PER_RUN");
const defaultRotationSlot = Math.floor(Date.now() / 86400000);
const rotationSlot = nonNegativeInteger(process.env.VZI_CPP_ROTATION_SLOT, defaultRotationSlot, "VZI_CPP_ROTATION_SLOT");
const batch = selectHarvestBatch(registry.sources, maxSources, rotationSlot);
try {
  for (const source of batch.selected) {
    try {
      const harvested = await harvestSource(runtime.cdp, source);
      const observedAt = new Date().toISOString();
      const contentSha256 = crypto.createHash("sha256").update(harvested.html).digest("hex");
      observations.push({
        school_id: source.school_id,
        source_url: source.url,
        observed_at: observedAt,
        rendered_html: harvested.html,
        content_sha256: contentSha256
      });
      results.push({
        school_id: source.school_id,
        school_name: source.school_name,
        rendered_nodes: harvested.nodeCount,
        skipped_unavailable: harvested.skippedUnavailable,
        status: "HARVESTED",
        content_sha256: contentSha256
      });
    } catch (error) {
      results.push({
        school_id: source.school_id,
        school_name: source.school_name,
        status: "FAILED",
        error: String(error?.message || error).slice(0, 400)
      });
    }
    await wait(2000);
  }
  if (observations.length === 0) {
    throw new Error("No approved browser source produced a publishable observation");
  }
  const generatedAt = new Date().toISOString();
  const manifest = {
    version: 2,
    generated_at: generatedAt,
    registry,
    registry_sha256: crypto.createHash("sha256").update(registryCanonical).digest("hex"),
    observations
  };
  const signingKey = process.env.VZI_CPP_MANIFEST_SIGNING_KEY;
  if (!signingKey) throw new Error("Missing secret: VZI_CPP_MANIFEST_SIGNING_KEY");
  manifest.signature = {
    algorithm: "Ed25519",
    key_id: "vzi-cpp-radar-2026-01",
    value: crypto.sign(null, Buffer.from(manifestSignatureMessage(manifest), "utf8"), signingKey).toString("base64")
  };
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const failed = results.filter((result) => result.status === "FAILED").length;
  process.stdout.write(`${JSON.stringify({
    status: failed === 0 ? "PASS" : "PASS_WITH_ERRORS",
    registry: { status: "preconfigured", source_count: registry.sources.length, sha256: manifest.registry_sha256 },
    batch: {
      eligible_source_count: batch.totalEligible,
      selected_source_count: batch.selected.length,
      max_sources_per_run: batch.maxSources,
      rotation_slot: batch.rotationSlot,
      start_index: batch.startIndex,
      school_ids: batch.selected.map((source) => source.school_id)
    },
    manifest: { path: manifestPath, generated_at: generatedAt, observation_count: observations.length },
    sources: results
  })}\n`);
} finally {
  try {
    await runtime.cdp.call("Browser.close");
  } catch {
    runtime.child.kill("SIGKILL");
  }
  runtime.cdp.close();
  await wait(250);
  if (runtime.child.exitCode === null) runtime.child.kill("SIGKILL");
  fs.rmSync(runtime.profile, { recursive: true, force: true });
}
