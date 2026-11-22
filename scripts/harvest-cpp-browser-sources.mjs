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
const dateBearingNamedPattern = String.raw`\b\d{1,2}\.?\s*(?:jan|feb|mar|apr|maj|jun|jul|avg|sep|okt|nov|dec)[a-zč]*\.?(?:\s*[–—-]\s*\d{1,2}\.|\s*,?\s*20\d{2}\b)`;

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
  const sharedNamed = text.match(/\b(\d{1,2})\.\s*(?:do|–|—|-)\s*(\d{1,2})\.\s*([\p{L}.]+)\s*(20\d{2})\b/iu);
  if (sharedNamed && monthNumber(sharedNamed[3])) {
    const startDate = isoDate(sharedNamed[4], monthNumber(sharedNamed[3]), sharedNamed[1]);
    const endDate = isoDate(sharedNamed[4], monthNumber(sharedNamed[3]), sharedNamed[2]);
    if (startDate && endDate && startDate <= endDate) return { startDate, endDate };
  }
  const fullNumericRange = text.match(/\b(\d{1,2})[./]\s*(\d{1,2})[./]\s*(20\d{2}|\d{2})\s*(?:do|–|—|-|in)\s*(\d{1,2})[./]\s*(\d{1,2})[./]\s*(20\d{2}|\d{2})\b/iu);
  const sharedNumericRange = text.match(/\b(\d{1,2})[./]\s*(\d{1,2})[./]\s*(?:do|–|—|-|in)\s*(\d{1,2})[./]\s*(\d{1,2})[./]\s*(20\d{2}|\d{2})\b/iu);
  const fullYear = value => String(value).length === 2 ? 2000 + Number(value) : Number(value);
  if (fullNumericRange || sharedNumericRange) {
    const m = fullNumericRange || sharedNumericRange;
    const startDate = isoDate(fullYear(fullNumericRange ? m[3] : m[5]), m[2], m[1]);
    const endDate = isoDate(fullYear(fullNumericRange ? m[6] : m[5]), fullNumericRange ? m[5] : m[4], fullNumericRange ? m[4] : m[3]);
    if (startDate && endDate && startDate <= endDate) return { startDate, endDate };
  }
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
  const namedDate = text.match(/\b(\d{1,2})\.?\s*([\p{L}.]+)\s*,?\s*(20\d{2})\b/iu);
  if (namedDate) {
    const month = monthNumber(namedDate[2]);
    const startDate = month ? isoDate(namedDate[3], month, namedDate[1]) : null;
    if (startDate) return { startDate, endDate: null };
  }
  const numericDate = text.match(/\b(\d{1,2})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(20\d{2}|\d{2})\b/u);
  if (numericDate) {
    const startDate = isoDate(fullYear(numericDate[3]), numericDate[2], numericDate[1]);
    if (startDate) return { startDate, endDate: null };
  }
  return null;
}

function canonicalTimeRange(value) {
  // A calendar date must never be interpreted as an hour and minute.
  const text = String(value)
    .replace(/\b\d{1,2}[./]\s*\d{1,2}[./]\s*(?:20\d{2}|\d{2})?\s*(?:do|–|—|-|in)\s*\d{1,2}[./]\s*\d{1,2}[./]\s*(?:20\d{2}|\d{2})\b/giu, ' ')
    .replace(/\b\d{1,2}\s*([./])\s*\d{1,2}\s*\1\s*(?:20\d{2}|\d{2})\b/gu, ' ');
  const range = text.match(/(?<![\d:.])(\d{1,2})[:.](\d{2})\s*h?\s*(?:do|–|—|-)\s*(\d{1,2})[:.](\d{2})\s*h?\b/iu);
  if (range && Number(range[1]) <= 23 && Number(range[2]) <= 59 && Number(range[3]) <= 23 && Number(range[4]) <= 59) {
    return { startTime: range[1].padStart(2, '0') + ':' + range[2] + ':00', endTime: range[3].padStart(2, '0') + ':' + range[4] + ':00' };
  }
  const hours = text.match(/\b(?:ob|od)\s*(\d{1,2})\s*(?:\.?\s*h\b|\.?\s*uri\b)/iu);
  if (hours && Number(hours[1]) <= 23) return { startTime: String(Number(hours[1])).padStart(2, "0") + ":00:00", endTime: null };
  const spaced = text.match(/\bob\s*(\d{1,2})\s+(\d{2})\s*min\b/iu);
  if (spaced && Number(spaced[1]) <= 23 && Number(spaced[2]) <= 59) return { startTime: spaced[1].padStart(2, "0") + ":" + spaced[2] + ":00", endTime: null };
  const shortRange = text.match(/(?<![\d:.])\b(\d{1,2})\s*[-–]\s*(\d{1,2}):(\d{2})\b/u);
  if (shortRange && Number(shortRange[1]) <= 23 && Number(shortRange[2]) <= 23 && Number(shortRange[3]) <= 59) return { startTime: shortRange[1].padStart(2, "0") + ":00:00", endTime: shortRange[2].padStart(2, "0") + ":" + shortRange[3] + ":00" };
  const match = text.match(/\b(\d{1,2})[:.](\d{2})\s*[–—-]\s*(\d{1,2})[:.](\d{2})\b/u);
  if (match) {
    const values = match.slice(1).map(Number);
    if (values[0] > 23 || values[1] > 59 || values[2] > 23 || values[3] > 59) return { startTime: null, endTime: null };
    return {
      startTime: `${String(values[0]).padStart(2, "0")}:${String(values[1]).padStart(2, "0")}:00`,
      endTime: `${String(values[2]).padStart(2, "0")}:${String(values[3]).padStart(2, "0")}:00`
    };
  }
  const single = text.match(/(?<![\d:.])\b(\d{1,2})[:.](\d{2})(?:h)?\b/iu);
  if (!single || Number(single[1]) > 23 || Number(single[2]) > 59) return { startTime: null, endTime: null };
  return {
    startTime: `${String(Number(single[1])).padStart(2, "0")}:${String(Number(single[2])).padStart(2, "0")}:00`,
    endTime: null
  };
}

function canonicalLocation(value) {
  const text = String(value).replace(/\s+/g, " ").trim();
  const timed = text.match(/([A-ZČŠŽ][\p{L}.'-]*\s+(?:ulica|cesta|trg|pot)\s+\d+[a-z]?,\s*[A-ZČŠŽ][\p{L} .'-]{1,60})\s*[·|]\s*\d{1,2}[:.]\d{2}/iu);
  if (timed) {
    const name = timed[1].replace(/\s+/g, " ").trim();
    const separator = name.lastIndexOf(",");
    return {
      name,
      streetAddress: separator > 0 ? name.slice(0, separator).trim() : name,
      addressLocality: separator > 0 ? name.slice(separator + 1).trim() : ""
    };
  }
  const inline = text.match(/\b((?:(?:Ulica|Cesta|Trg|Pot)\s+[A-ZČŠŽ][\p{L}.'-]*(?:\s+[\p{L}.'-]+){0,4}|[A-ZČŠŽ][\p{L}.'-]*(?:\s+[\p{L}.'-]+){0,4}\s+(?:ulica|cesta|trg|pot))\s+\d+[a-z]?),\s*(?:\d{4}\s+)?([A-ZČŠŽ][\p{L}.'-]*(?:\s+[\p{L}.'-]+){0,2})/iu);
  if (!inline) return null;
  const streetAddress = inline[1].replace(/\s+/g, " ").trim();
  const addressLocality = inline[2].replace(/\s+/g, " ").trim().replace(/\.$/u, "");
  return {
    name: `${streetAddress}, ${addressLocality}`,
    streetAddress,
    addressLocality
  };
}

function isUnavailableTerm(value) {
  return /\b(?:termin\s+(?:je\s+)?poln|razprodano|zapolnjen[ao]?|ni\s+(?:ve\u010d\s+)?prostih\s+mest|vsa\s+mesta\s+so\s+zasedena)\b/iu.test(String(value));
}

function explicitCategoryText(value) {
  const text = String(value).replace(/_/g, " ");
  const token = "(?:D1E|C1E|A1|A2|AM|BE|C1|CE|D1|DE|B1|A|B|C|D|F|G)";
  const sequence = token + "(?:\\s*[,/]\\s*" + token + ")*";
  const beforeLabel = text.match(new RegExp("\\b(" + sequence + ")\\s*[-–]?\\s*(?:kategorij[a-zčšž]*|kat\\.)", "iu"));
  const afterLabel = text.match(new RegExp("\\b(?:dodatni\\s+del(?:\\s+za)?|kategorij[a-zčšž]*\\s*:?)\\s+(" + sequence + ")(?![a-z0-9])", "iu"));
  const match = beforeLabel || afterLabel;
  return match ? [...new Set(match[1].toUpperCase().split(/\s*[,/]\s*/u))].join(", ") : "";
}

function dateNodePayloadItem(item) {
  const identityText = String(item.text);
  const text = [identityText, item.contextText].filter(Boolean).join(" ").replace(/_/g, " ").replace(/\s+/g, " ").trim();
  const dates = canonicalDateRange(item.startDateText || identityText);
  if (!dates) return null;
  const endDate = item.endDateText ? canonicalDateRange(item.endDateText)?.startDate : null;
  if (endDate && endDate >= dates.startDate) dates.endDate = endDate;
  const titleText = String(item.titleText || "").replace(/_/g, " ").trim();
  const categoryText = explicitCategoryText(item.categoryText === undefined ? titleText + " " + text : item.categoryText);
  const courseType = item.courseType || (/\b(?:splošni|osnovni)[-\s]+del\b/iu.test(text)
    ? "CPP_GENERAL"
    : /\bdodatni\s+del\b/iu.test(text) ? "CPP_ADDITIONAL" : categoryText ? "CPP_UNSPECIFIED" : "CPP_GENERAL");
  const priceMatch = String(item.priceText || "").match(/\bcena:\s*(\d+(?:[.,]\d{1,2})?)\s*€/iu);
  const times = canonicalTimeRange(item.timeText || (item.suppressContextTime ? identityText : text));
  if (item.unknownTime) times.startTime = times.endTime = null;
  if (item.endTimeText) times.endTime = canonicalTimeRange(item.endTimeText).endTime;
  return {
    text,
    identityText,
    titleText,
    dates,
    times,
    location: item.explicitLocation || canonicalLocation(item.locationText || text),
    courseType,
    categoryText,
    eventStatus: item.eventStatus || null,
    mode: item.mode || (/\b(?:na\s+daljavo|online)\b/iu.test(text) ? "ONLINE" : null),
    priceAmount: priceMatch ? Number(priceMatch[1].replace(",", ".")) : null,
    registrationUrl: item.registrationUrl || null
  };
}

function amzsTermFields(value) {
  const text=String(value).replace(/\s+/gu,' ').trim();
  const range=text.match(/(\d{1,2}\.\s*\d{1,2}\.\s*20\d{2})\s*\((\d{1,2}:\d{2})\)\s*[-–—]\s*(\d{1,2}\.\s*\d{1,2}\.\s*20\d{2})\s*\((\d{1,2}:\d{2})\)/u);
  if(!range)return null;
  const first=canonicalDateRange(range[1]),last=canonicalDateRange(range[3]);
  if(!first||!last||last.startDate<first.startDate)return null;
  // The date-range widget repeats the start time as its end time. The
  // published session hours supply the actual finish (e.g. 18:30, not 15:30).
  const hours=[...text.matchAll(/(?:\bod\s*)?(\d{1,2}:\d{2})\s*(?:do|[-–—])\s*(\d{1,2}:\d{2})/giu)].at(-1);
  const place=text.match(/\blokacija:\s*([^\)]+?)(?:,\s*Datumi:|\s*\(|$)/iu)?.[1];
  const pieces=String(place||'').split(',').map(s=>s.trim());
  const locality=pieces[1]?.replace(/^\d{4}\s+/u,'');
  const location=pieces.length===2&&/\d/u.test(pieces[0])&&locality&&/^[\p{L} .'-]+$/u.test(locality)?{name:pieces[0]+', '+locality,streetAddress:pieces[0],addressLocality:locality}:null;
  if(!location)return null;
  return {startDateText:range[1],endDateText:range[3],timeText:'ob '+range[2]+'-'+(hours?.[2]||range[4]),explicitLocation:location,mode:'CLASSROOM'};
}

function publicCourseItems(schoolId, item) {
  if(schoolId===3158){const fields=amzsTermFields(item.text);return fields?[{...item,...fields}]:[];}

  if (schoolId === 3086) {
    // Numbered paragraphs are separate courses; days within each are sessions.
    return String(item.lines || item.text).split(/(?:^|\n)\s*\d+\.\s+/u).filter(t=>/20\d{2}/u.test(t)).map(text=>{
      text=text.split(/Informacije in prijave/iu)[0].trim();
      const fullDates=Array.from(text.matchAll(/\b\d{1,2}\.\s*\d{1,2}\.\s*20\d{2}\b/gu));
      return {...item,text,endDateText:fullDates.at(-1)?.[0]};
    });
  }
  if (schoolId === 3087) {
    // Brulc publishes the year once at the end of the list of course days.
    const shared = item.text.match(/\b(\d{1,2})\.(\d{1,2})\.,\s*(?:\d{1,2}\.\d{1,2}\.,\s*)*(\d{1,2})\.(\d{1,2})\.(20\d{2})\b/u);
    if (shared && Number(shared[2]) <= Number(shared[4])) {
      item.startDateText=shared[1]+'.'+shared[2]+'.'+shared[5];
      item.endDateText=shared[3]+'.'+shared[4]+'.'+shared[5];
    }
  }
  if (schoolId === 3063) {
    return String(item.lines || item.text).split(/\n\s*\n/u).filter(t=>canonicalDateRange(t)).map(text=>({...item,text}));
  }
  if (schoolId === 3073) {
    const result = [];
    let category = '';
    const lines = String(item.lines || '').split(/\n/u).map(s => s.trim()).filter(Boolean);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (/kategorija/iu.test(line)) category = line;
      if (category && /^\d{1,2}\.\d{1,2}\.20\d{2}\b/u.test(line)) {
        const next = lines[index + 1] || '';
        const timeText = /^(?:ob|od)\s*\d/iu.test(next) ? next : line;
        result.push({ text: category + ' ' + line + ' ' + timeText, titleText: 'Tečaj CPP — ' + category, timeText });
      }
    }
    return result;
  }
  if (schoolId === 3179 && !/splošni del/iu.test(item.text)) {
    return Array.from(item.text.matchAll(/\b(A1|A2|AM|BE|CE|A|B|C|D)-kat\.\s*[-=]>\s*(\d{1,2}\.\d{1,2}\.\d{2,4})\b/giu), m => ({
      ...item, text: 'Dodatni del tečaja CPP — kategorija ' + m[1] + ': ' + m[2], titleText: 'Dodatni del tečaja CPP — kategorija ' + m[1]
    }));
  }
  if ([3058, 3091, 3099, 3116, 3190].includes(schoolId)) {
    const dates = Array.from(item.text.matchAll(/\b\d{1,2}\.\s*\d{1,2}\.\s*(?:20\d{2}|\d{2})\b/gu));
    if (dates.length > 1) {
      item.endDateText = dates.at(-1)[0];
      item.endTimeText = item.text.slice(dates.at(-1).index);
    }
  }
  return [item];
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

// A targeted repair can retain recent observations only after authenticating
// their complete registry/signature and independently checking every HTML hash.
function reuseVerifiedObservations(previous, fresh, currentRegistry, publicKey, now, schoolId) {
  const expected=crypto.createHash('sha256').update(JSON.stringify(currentRegistry)).digest('hex');
  if(previous.registry_sha256!==expected || crypto.createHash('sha256').update(JSON.stringify(previous.registry)).digest('hex')!==expected) throw new Error('Cached registry mismatch');
  const generated=Date.parse(previous.generated_at);
  if(!Number.isFinite(generated)||generated<now-2*3600000||generated>now+300000)throw new Error('Cached manifest is not recent');
  if(previous.signature?.algorithm!=='Ed25519'||!crypto.verify(null,Buffer.from(manifestSignatureMessage(previous),'utf8'),publicKey,Buffer.from(previous.signature.value||'','base64')))throw new Error('Cached signature failed');
  const allowed=new Set(currentRegistry.sources.filter(s=>s.approved&&s.enabled).map(s=>s.school_id+'|'+s.url));
  for(const observation of previous.observations) {
    const observed=Date.parse(observation.observed_at);
    if(!allowed.has(observation.school_id+'|'+observation.source_url)||!Number.isFinite(observed)||observed<now-2*3600000||observed>now+300000)throw new Error('Cached observation is not eligible');
    if(crypto.createHash('sha256').update(observation.rendered_html||'').digest('hex')!==observation.content_sha256)throw new Error('Cached observation hash failed');
  }
  if(!fresh.length || fresh.some(o=>o.school_id!==schoolId))throw new Error('Targeted refresh did not succeed');
  return [...previous.observations.filter(o=>o.school_id!==schoolId),...fresh];
}

validateRegistry(registry);
// These sources require a normal public browser review. Do not request their
// blocked headless route or restamp an older reviewed capture as a new visit.
const publicBrowserReviewSchools = new Set([3147]);
function reviewedPublicCapture(source, record, now = Date.now()) {
  if (record?.version !== 1 || record.method !== 'agent_public_browser_review' || record.school_id !== source.school_id || record.source_url !== source.url) throw new Error('Public review identity mismatch');
  const observed = Date.parse(record.observed_at);
  if (!Number.isFinite(observed) || observed > now + 300000 || observed < now - 7*86400000) throw new Error('Public browser review is missing or stale; refresh in the normal public browser');
  if (typeof record.rendered_html !== 'string' || !record.rendered_html || crypto.createHash('sha256').update(record.rendered_html).digest('hex') !== record.content_sha256) throw new Error('Public review content hash failed');
  if (!Number.isSafeInteger(record.course_count) || record.course_count < 1 || record.course_count > source.max_nodes) throw new Error('Public review course count is invalid');
  return {html: record.rendered_html, observedAt: record.observed_at, nodeCount: record.course_count, skippedUnavailable: 0, method: record.method};
}

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
  const dateNodeGeneralThenAdditional = dateNodePayloadItem({
    text: "Splošni del za B - 28. september 2026 ob 15.00. Takoj bo sledil dodatni del za B."
  });
  const tiliaCourse = dateNodePayloadItem({
    text: "21.9.2026 (September) - B kategorija Vsi tečaji se začnejo v ponedeljek ob 17:00"
  });
  const browserNamedDate = new RegExp(dateBearingNamedPattern, "iu");
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
  const formulaTerm = dateNodePayloadItem({
    text: "Tečaj CPP za CE kategorijo cena: 60,00 € torek 24.11.2026 13:00 Cesta k Tamu 6, Maribor prosto PRIJAVA",
    titleText: "Tečaj CPP za CE kategorijo",
    timeText: "ob 13:00",
    locationText: "Cesta k Tamu 6, Maribor",
    priceText: "Tečaj CPP za CE kategorijo cena: 60,00 €"
  });
  const ninoTerm = dateNodePayloadItem({
    text: "Četrtek, 10.12.2026 Tečaj CPP_dodatni del A1,A2,A Mesta na voljo",
    titleText: "Tečaj CPP_dodatni del A1,A2,A",
    contextText: "Tečaj poteka na sedežu šole vožnje, Notranjska cesta 14, Logatec.",
    timeText: "Popoldanski termin, začetek ob 18:00"
  });
  const alfaTerm = dateNodePayloadItem({
    text: "TEČAJI V NOVEMBRU – 23.11.2026",
    titleText: "TEČAJ CPP (osnovni-splošni del + dodatni del B-kat.)",
    contextText: "OSNOVNI DEL: Zbor ob 14.10 pred učilnico AlfaGo Novi trg 7.",
    locationText: "Novi trg 7, NOVO MESTO",
    suppressContextTime: true
  });
  const cacheRegistry={sources:[{school_id:1,url:'https://school.example/a',approved:true,enabled:true},{school_id:2,url:'https://school.example/b',approved:true,enabled:true}]};
  const cacheNow=Date.parse('2026-11-21T22:00:00Z');
  const cacheObservation=id=>({school_id:id,source_url:'https://school.example/'+(id===1?'a':'b'),observed_at:'2026-11-21T21:50:00Z',rendered_html:'public term '+id,content_sha256:crypto.createHash('sha256').update('public term '+id).digest('hex')});
  const cacheFixture={version:2,generated_at:'2026-11-21T21:55:00Z',registry:cacheRegistry,registry_sha256:crypto.createHash('sha256').update(JSON.stringify(cacheRegistry)).digest('hex'),observations:[cacheObservation(1),cacheObservation(2)]};
  cacheFixture.signature={algorithm:'Ed25519',value:crypto.sign(null,Buffer.from(manifestSignatureMessage(cacheFixture),'utf8'),signatureKeys.privateKey).toString('base64')};
  const refuses=fn=>{try{fn();return false;}catch{return true;}};
  const changedHtml=structuredClone(cacheFixture);changedHtml.observations[1].rendered_html='tampered term';
  const changedSignature=structuredClone(cacheFixture);changedSignature.signature.value='AAAA';
  const reviewSource={school_id:3147,url:'https://ilke.si/',max_nodes:50};
  const reviewFixture={version:1,method:'agent_public_browser_review',school_id:3147,source_url:'https://ilke.si/',observed_at:'2026-11-21T21:50:00Z',rendered_html:'reviewed public course',course_count:1};
  reviewFixture.content_sha256=crypto.createHash('sha256').update(reviewFixture.rendered_html).digest('hex');
  const amzsLj='24.11.2026 (15:30) - 2.12.2026 (15:30) (lokacija: Dunajska 128, Ljubljana, Datumi: 24., 25., 26., 27.,01. in 02.12.2026 od 15:30 do 18:30)';
  const amzsTr='7.12.2026 (16:00) - 15.12.2026 (16:00) (Lokacija: Trubarjeva ulica 2, Trebnje, Datumi: 7., 8., 9., 10., 14., 15.12.2026, 16:00-19:00)';
  const amzsA='25.1.2027 (15:30) - 26.1.2027 (15:30) (lokacija: Dunajska 128, Ljubljana (25. in 26.1.2027 od 15:30 do 18:30)';
  const amzsPayload=text=>dateNodePayloadItem(publicCourseItems(3158,{text,titleText:'Splošni del tečaja CPP',categoryText:'',courseType:'CPP_GENERAL'})[0]);
  const checks = [
    amzsPayload(amzsLj).dates.startDate==='2026-11-24'&&amzsPayload(amzsLj).dates.endDate==='2026-12-02',
    amzsPayload(amzsLj).times.startTime==='15:30:00'&&amzsPayload(amzsLj).times.endTime==='18:30:00',
    amzsPayload(amzsLj).location.addressLocality==='Ljubljana',
    amzsPayload(amzsTr).dates.endDate==='2026-12-15'&&amzsPayload(amzsTr).times.endTime==='19:00:00',
    amzsPayload(amzsTr).location.streetAddress==='Trubarjeva ulica 2',
    amzsPayload(amzsA).dates.endDate==='2027-01-26'&&amzsPayload(amzsA).location.addressLocality==='Ljubljana',
    amzsPayload(amzsLj).categoryText===''&&amzsPayload(amzsLj).mode==='CLASSROOM',
    amzsTermFields(amzsLj.replace('24.11.2026','31.11.2026'))===null,
    amzsTermFields(amzsLj.replaceAll('2026',''))===null,
    amzsTermFields('Sprejemna pisarna 23.11.2026 ZAPRTA')===null,

    reviewedPublicCapture(reviewSource,reviewFixture,cacheNow).observedAt===reviewFixture.observed_at,
    refuses(()=>reviewedPublicCapture(reviewSource,{...reviewFixture,school_id:1},cacheNow)),
    refuses(()=>reviewedPublicCapture(reviewSource,{...reviewFixture,source_url:'https://other.example/'},cacheNow)),
    refuses(()=>reviewedPublicCapture(reviewSource,reviewFixture,cacheNow+8*86400000)),
    refuses(()=>reviewedPublicCapture(reviewSource,{...reviewFixture,observed_at:'2026-11-22T21:50:00Z'},cacheNow)),
    refuses(()=>reviewedPublicCapture(reviewSource,{...reviewFixture,rendered_html:'tampered'},cacheNow)),
    refuses(()=>reviewedPublicCapture(reviewSource,{...reviewFixture,course_count:0},cacheNow)),
    reuseVerifiedObservations(cacheFixture,[cacheObservation(1)],cacheRegistry,signatureKeys.publicKey,cacheNow,1).length===2,
    refuses(()=>reuseVerifiedObservations(changedHtml,[cacheObservation(1)],cacheRegistry,signatureKeys.publicKey,cacheNow,1)),
    refuses(()=>reuseVerifiedObservations(changedSignature,[cacheObservation(1)],cacheRegistry,signatureKeys.publicKey,cacheNow,1)),
    refuses(()=>reuseVerifiedObservations(cacheFixture,[cacheObservation(1)],cacheRegistry,signatureKeys.publicKey,cacheNow+3*3600000,1)),
    refuses(()=>reuseVerifiedObservations(cacheFixture,[cacheObservation(1)],{sources:cacheRegistry.sources.slice(0,1)},signatureKeys.publicKey,cacheNow,1)),
    refuses(()=>reuseVerifiedObservations(cacheFixture,[],cacheRegistry,signatureKeys.publicKey,cacheNow,1)),
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
    isUnavailableTerm("27.7.2026 ob 9:00 VSA MESTA SO ZASEDENA"),
    !isUnavailableTerm("15. okt. – 21. okt. 2026"),
    relaxGeneral?.courseType === "CPP_GENERAL" && relaxGeneral?.location?.addressLocality === "Maribor",
    relaxAdditional?.courseType === "CPP_ADDITIONAL" && relaxAdditional?.mode === "ONLINE" && relaxAdditional?.categoryText === "A1, A2, A",
    relaxRejected === null,
    dateNodeAdditional?.courseType === "CPP_ADDITIONAL" && dateNodeAdditional?.dates.startDate === "2026-09-23",
    dateNodeGeneralThenAdditional?.courseType === "CPP_GENERAL" && dateNodeGeneralThenAdditional?.dates.startDate === "2026-09-28",
    tiliaCourse?.dates.startDate === "2026-09-21" && tiliaCourse?.times.startTime === "17:00:00",
    browserNamedDate.test("Ponedeljek, 7. September 2026 Cesta Staneta Žagarja 27a, 4000 Kranj"),
    browserNamedDate.test("23. sep. – 29. sep. 2026 Termin poln"),
    crypto.verify(null, fixtureMessage, signatureKeys.publicKey, fixtureSignature),
    manifestSignatureMessage(signatureFixture).startsWith("vzi-cpp-browser-manifest-v2\n"),
    signatureFixture.registry === registry,
    firstBatch.selected.map((source) => source.school_id).join(",") === Array.from({ length: 20 }, (_, index) => index + 1).join(","),
    secondBatch.selected.map((source) => source.school_id).join(",") === Array.from({ length: 20 }, (_, index) => index + 21).join(","),
    thirdBatch.selected.map((source) => source.school_id).join(",") === [...Array.from({ length: 5 }, (_, index) => index + 41), ...Array.from({ length: 15 }, (_, index) => index + 1)].join(","),
    rotationCoverage.size === 45,
    filteredBatch.totalEligible === 1 && filteredBatch.selected[0]?.school_id === 1,
    positiveInteger("20", 10, "test") === 20,
    nonNegativeInteger("0", 5, "test") === 0,
    formulaTerm?.categoryText === "CE" && formulaTerm?.courseType === "CPP_UNSPECIFIED",
    formulaTerm?.times.startTime === "13:00:00",
    formulaTerm?.location?.name === "Cesta k Tamu 6, Maribor",
    formulaTerm?.priceAmount === 60,
    ninoTerm?.categoryText === "A1, A2, A" && ninoTerm?.courseType === "CPP_ADDITIONAL",
    ninoTerm?.times.startTime === "18:00:00" && ninoTerm?.location?.addressLocality === "Logatec",
    alfaTerm?.location?.name === "Novi trg 7, NOVO MESTO" && alfaTerm?.times.startTime === null,
    alfaTerm?.categoryText === "B" && alfaTerm?.identityText === "TEČAJI V NOVEMBRU – 23.11.2026",
    explicitCategoryText("Tečaj CPP za D kategorijo") === "D",
    explicitCategoryText("Tečaj CPP za C kategorijo") === "C",
    explicitCategoryText("Tečaj CPP") === "",
    isUnavailableTerm("Ponedeljek, 23.11.2026 Tečaj CPP Ni več prostih mest"),
    canonicalDateRange("23.11. do 30.11. 2026")?.startDate === "2026-11-23",
    canonicalDateRange("1.12.26 do 9.12.26")?.endDate === "2026-12-09",
    canonicalDateRange("23. 11. in 24. 11. 26")?.startDate === "2026-11-23",
    canonicalDateRange("23 novembra, 2026")?.startDate === "2026-11-23",
    canonicalTimeRange("ob 16h").startTime === "16:00:00",
    canonicalTimeRange("ob 15 30 min").startTime === "15:30:00",
    canonicalTimeRange("ob 17.h").startTime === "17:00:00",
    new RegExp(dateBearingNamedPattern, "iu").test("23 novembra, 2026 17:00"),
    canonicalTimeRange('1.12.26 do 9.12.26 ob 15 30 min do 18 30 min').startTime === '15:30:00',
    canonicalTimeRange('11. 1. 27 – 20. 1. 27 od 15.30 do 18.30').endTime === '18:30:00',
    canonicalTimeRange('23.11. do 30.11. 2026 / 16 - 19:15').startTime === '16:00:00',
    canonicalTimeRange('7.12.2026 - 15.12.2026 od 15.45 - 18.45 ure').endTime === '18:45:00',
    canonicalTimeRange('30.11.2026 14:00 Tečaj CPP - kategorija B').startTime === '14:00:00',
    canonicalTimeRange('23 novembra, 2026 17:00').startTime === '17:00:00',
    canonicalTimeRange('14.12.26 vsi dnevi: 14,15,16,17,21 in 22.12.26').startTime === null,
    canonicalTimeRange('Začetek tečaja 23. november 2026 ob 17. uri').startTime === '17:00:00',
    canonicalTimeRange('Tečaj CPP 03.12.2026 ob 16h').startTime === '16:00:00',
    publicCourseItems(3179, {text:'A-kat. -> 24.11.26 C-kat. -> 11.01.27 CE-kat. -> 13.01.27 BE-kat. -> 14.01.27'}).length === 4,
    dateNodePayloadItem(publicCourseItems(3179, {text:'CE-kat. -> 13.01.27'})[0]).categoryText === 'CE',
    publicCourseItems(3073, {lines:'B,A1,AM kategorija\n3.12.2026\nod 16h-19h\nA kategorija\n(poteka 2 dni)\n25.11.2026\nob 16h-19h'}).length === 2,
    dateNodePayloadItem(publicCourseItems(3073, {lines:'B,A1,AM kategorija\n3.12.2026\nod 16h-19h'})[0]).categoryText === 'B, A1, AM',
    dateNodePayloadItem(publicCourseItems(3116, {text:'CPP - DECEMBER 2026 07.12.2026.....16:00-18:30 08.12.2026.....16:00-19:00 17.12.2026.....16:00-19:00'})[0]).dates.endDate === '2026-12-17',
    publicCourseItems(3058, {text:'Tečaj CPP: 24.11.2026 ob 15:00, 26.11.2026 ob 15:00, 8.12.2026 ob 15:00'}).length === 1,
    dateNodePayloadItem(publicCourseItems(3099, {text:'Tečaj CPP - C kategorije 03.12.2026 ob 16h 04.12.2026 ob 16h'})[0]).dates.endDate === '2026-12-04',
    dateNodePayloadItem({text:'25.11.2026 ob 16.00',explicitLocation:{name:'Slovenj Gradec',streetAddress:'',addressLocality:'Slovenj Gradec'}}).location.addressLocality === 'Slovenj Gradec',
    robotsAllows('User-agent: *\nDisallow: /*?add-to-cart=\nDisallow: /*?*add-to-cart=\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php', '/prijava-na-tecaj-cpp/'),
    !robotsAllows('User-agent: *\nDisallow: /*?*add-to-cart=', '/shop/?product=5&add-to-cart=10'),
    !robotsAllows('User-agent: *\nDisallow: /private/', '/private/calendar'),
    robotsAllows('User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php', '/wp-admin/admin-ajax.php'),
    robotsAllows('User-agent: *\nDisallow: /private$','/private-more'),
    !robotsAllows('User-agent: *\nDisallow: /private$','/private'),
    canonicalTimeRange('SREDA, 02.12.2026 ob 14.30h').startTime === '14:30:00',
    canonicalTimeRange('sob., 05.12.2026, 07.00h').startTime === '07:00:00',
    dateNodePayloadItem(publicCourseItems(3116, {text:'CPP - DECEMBER 2026 07.12.2026.....16:00-18:30 17.12.2026.....16:00-19:00'})[0]).times.endTime === '19:00:00',
    dateNodePayloadItem(publicCourseItems(3099, {text:'Tečaj CPP - C kategorije 03.12.2026 ob 16h 04.12.2026 ob 16h'})[0]).times.endTime === null,
    publicCourseItems(3190, {text:'1. Srečanje: 7.12.2026 ob 17:00 2. Srečanje: 8.12.2026 ob 17:00 6. Srečanje: 14.12.2026 ob 17:00'}).length === 1,
    dateNodePayloadItem(publicCourseItems(3190, {text:'1. Srečanje: 7.12.2026 ob 17:00 6. Srečanje: 14.12.2026 ob 17:00',titleText:'Tečaj CPP — splošni del in dodatni del B kategorije'})[0]).dates.endDate === '2026-12-14',
    dateNodePayloadItem({text:'1. december ob 15.30'}) === null,
    dateNodePayloadItem({text:'Tečaj CPP — kategorije A, A1, A2, AM 13/1/2027 19:15 Na daljavo'}).categoryText === 'A, A1, A2, AM',
    dateNodePayloadItem({text:'Tečaj CPP — kategorije A, A1, A2, AM 13/1/2027 19:15 Na daljavo'}).times.startTime === '19:15:00',
    dateNodePayloadItem({text:'Tečaj CPP — kategorija B 04.1.2026 ob 15:00'}).dates.startDate === '2026-01-04',
    dateNodePayloadItem({text:'Tečaj CPP — kategorija CE 16.12.2026 ob 15.30 (možno tudi online)'}).categoryText === 'CE',
    dateNodePayloadItem({text:'30.11.2026 ob 16:00',titleText:'Tečaj CPP — B kategorija',explicitLocation:{name:'Tolmin',streetAddress:'',addressLocality:'Tolmin'}}).location.addressLocality === 'Tolmin',
    censusLinkScore({text:'CPP tečaji',url:'https://neja74.wixsite.com/website/cpp-te%C4%8Daji'}) > censusLinkScore({text:'Urnik pouka',url:'https://school.example/izobrazevanje-odraslih/urnik/'}),
    censusLinkScore({text:'Zaščita prijaviteljev',url:'https://school.example/zascita-prijaviteljev/'}) < 0,
    censusLinkScore({text:'CPP urnik PDF',url:'https://school.example/files/cpp.pdf'}) >= 100,
    censusLinkScore({text:'Prijava na CPP',url:'https://forms.gle/public-form',nearby:'Tečaj CPP'}) >= 100,
    !censusCourseEvidence('Šola se z 31.12.2026 poslavlja.', 'Tečaj CPP'),
    !censusCourseEvidence('EKO semenarjenje 25.04.2025 - 25.04.2028','Center biotehnike'),
    censusCourseEvidence('7. 12. 2026', 'Začetki tečajev CPP Kategorija B'),
    censusLinkScore({text:'Redno usposabljanje KODA 95',url:'https://school.example/koda95-termini'}) < 0,
    canonicalDateRange('14. do 21. decembra 2026')?.startDate === '2026-12-14',
    canonicalDateRange('18. do 25. januarja 2027')?.endDate === '2027-01-25',
    canonicalDateRange('15. do 22. februarja 2027')?.startDate === '2027-02-15',
    dateNodePayloadItem(publicCourseItems(3087,{text:'CPP TEČAJ B - kategorija 02.12., 03.12., 07.12., 08.12., 09.12., 10.12.2026 ob 16.00 uri'})[0]).dates.startDate === '2026-12-02',
    dateNodePayloadItem(publicCourseItems(3087,{text:'02.12., 03.12., 10.12.2026 ob 16.00 uri'})[0]).dates.endDate === '2026-12-10',
    dateNodePayloadItem({text:'CPP TEČAJ CE - kategorija 26.11.2026 POGOJ: OPRAVLJEN IZPIT C - KATEGORIJE!',categoryText:'CPP TEČAJ CE - kategorija'}).categoryText === 'CE',
    dateNodePayloadItem({text:'CPP TEČAJ C - kategorija 23.11. IN 24.11.2026 POGOJ: B - KAT.',categoryText:'CPP TEČAJ C - kategorija'}).categoryText === 'C',
    publicCourseItems(3086,{lines:'1. pon.-čet. od 26.10.-29.10.2026 in pon.-tor. 2.11. in 3.11.2026 od 17:00-20:00\n2. pon.-čet. od 30.11.-3.12.2026 in pon.-tor. 7.12. in 8.12.2026 od 17:00-20:00'}).length === 2,
    dateNodePayloadItem(publicCourseItems(3086,{lines:'2. pon.-čet. od 30.11.-3.12.2026 in pon.-tor. 7.12. in 8.12.2026 od 17:00-20:00'})[0]).dates.startDate === '2026-11-30',
    dateNodePayloadItem(publicCourseItems(3086,{lines:'2. pon.-čet. od 30.11.-3.12.2026 in pon.-tor. 7.12. in 8.12.2026 od 17:00-20:00'})[0]).dates.endDate === '2026-12-08',
    dateNodePayloadItem({text:'Tečaj CPP 7.12.2026 ob 00:00',unknownTime:true}).times.startTime === null,
    dateNodePayloadItem({text:'Tečaj CPP za E kat. 10.12.2026',categoryText:'Tečaj CPP - E kat.'}).categoryText === '',
    publicCourseItems(3063,{lines:'7. 12. 2026 ob 15.00 - Petrov trg 7, Šempeter\nTečaj CPP\n\njanuar 2027 ob 15.00 - Petrov trg 7, Šempeter'}).length === 1
  ];
  if (checks.some((passed) => !passed)) throw new Error('Browser structured-event self-test failed: ' + checks.flatMap((passed, index) => passed ? [] : [index + 1]).join(', '));
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
  socket.addEventListener("close", () => {
    for (const task of pending.values()) task.reject(new Error("Chrome CDP connection closed"));
    pending.clear();
  });
  return {
    call(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Chrome CDP timeout: '+method));},60000);
        pending.set(id, {
          resolve(value) {clearTimeout(timer);resolve(value);},
          reject(error) {clearTimeout(timer);reject(error);}
        });
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
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        version = await response.json();
        break;
      }
    } catch {
      // Chrome is still starting.
    }
    await wait(250);
  }
  if (!version?.webSocketDebuggerUrl) {
    if (child.exitCode === null) child.kill('SIGKILL');
    fs.rmSync(profile, { recursive:true, force:true, maxRetries:8, retryDelay:250 });
    throw new Error('Chrome did not expose a local CDP endpoint within the startup window');
  }
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
    if (!rule.path) continue;
    const terminal = rule.path.endsWith('$');
    const pattern = (terminal ? rule.path.slice(0, -1) : rule.path)
      .split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    if (!new RegExp('^' + pattern + (terminal ? '$' : '')).test(pathName)) continue;
    const specificity = rule.path.replace(/[*$]/gu, '').length;
    if (specificity > longest || specificity === longest && rule.field === 'allow') {
      longest = specificity;
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Chrome evaluation failed");
  return result.result?.value;
}

async function navigate(cdp, url, settleMilliseconds = 3000) {
  await cdp.call("Page.navigate", { url });
  await wait(settleMilliseconds);
}

// Traverse only the school's public category/mode/location selectors. No personal
// information is entered and the registration form is never submitted.
async function collectSmarcaPublicTerms(cdp) {
  return evaluate(cdp, `(async () => {
    const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
    const clean = value=>String(value||'').replace(/\\s+/gu,' ').trim();
    const select = (id,value) => {
      const node=document.getElementById(id);
      if(!node || !Array.from(node.options).some(o=>o.value===value)) return false;
      node.value=value; node.dispatchEvent(new Event('change',{bubbles:true})); return true;
    };
    const categoryNode=document.getElementById('form-field-kategorija');
    if(!categoryNode) return {title:document.title,items:[]};
    const categories=Array.from(new Set(Array.from(categoryNode.options,o=>o.value))).filter(Boolean);
    const items=[];
    for(const category of categories) {
      select('form-field-kategorija',category); await pause(250);
      for(const mode of ['Online','Fizično']) {
        const modeNode=document.getElementById('form-field-nacin');
        const choice=Array.from(modeNode?.parentElement.querySelectorAll('li p')||[]).find(p=>clean(p.textContent)===mode);
        if(!choice) continue;
        choice.click(); await pause(300);
        const locationNode=document.getElementById('form-field-lokacija');
        const places=mode==='Online'?['Online']:Array.from(locationNode?.options||[],o=>o.value).filter(v=>v&&v!=='Online');
        for(const place of places) {
          if(mode!=='Online') {select('form-field-lokacija',place);await pause(250);}
          if(document.getElementById('form-field-nacin')?.value!==mode) continue;
          const group=category==='MOTO'?'A, A1, A2, AM':category;
          const locationName=mode==='Online'?'Na daljavo':place;
          for(const option of document.querySelectorAll('#form-field-datum option')) {
            const date=clean(option.textContent);
            if(!/\\b\\d{1,2}\\/\\d{1,2}\\/20\\d{2}\\s+\\d{1,2}:\\d{2}/u.test(date)) continue;
            const titleText='Tečaj CPP — kategorije '+group;
            items.push({text:titleText+' '+date+' '+locationName,titleText,timeText:date,mode:mode==='Online'?'ONLINE':'CLASSROOM',explicitLocation:{name:locationName,streetAddress:'',addressLocality:locationName},registrationUrl:location.href});
          }
        }
      }
    }
    return {title:document.title,items};
  })()`);
}

// Public event detail links expose complete, publisher-authored JSON-LD dates.
async function collectBliskPublicTerms(cdp, source) {
  const links = await evaluate(cdp, `(() => Array.from(document.querySelectorAll('li[data-hook="event-list-item"]')).filter(n=>/CPP|cestno.?promet/iu.test(n.innerText)).map(n=>({url:Array.from(n.querySelectorAll('a[href]')).find(a=>a.href.startsWith(location.origin+'/event-details/'))?.href,label:n.querySelector('[data-hook="ev-list-item-location"]')?.innerText||n.innerText})).filter(x=>x.url))()`);
  const items=[];
  for (const link of links.slice(0,source.max_nodes)) {
    await assertRobotsAllowed({...source,url:link.url});
    await navigate(cdp,link.url,1600);
    let result;
    for(let attempt=0;attempt<5;attempt++) {
      result=await evaluate(cdp, `(() => {
        const events=[];
        const walk=v=>{if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object'){if(String(v['@type']||'').includes('Event')&&v.startDate&&/CPP|cestno.?promet/iu.test([v.name,v.description].join(' ')))events.push(v);if(v['@graph'])walk(v['@graph']);}};
        for(const node of document.querySelectorAll('script[type="application/ld+json"]')){try{walk(JSON.parse(node.textContent));}catch{}}
        return events[0]||null;
      })()`);
      if(result) break;
      await wait(700);
    }
    if(!result) throw new Error('Blisk: public event detail has no published dates: '+link.url);
    const start=String(result.startDate).match(/^(20\d{2})-(\d{2})-(\d{2})T(\d{2}:\d{2})/u);
    const end=String(result.endDate||'').match(/^(20\d{2})-(\d{2})-(\d{2})T(\d{2}:\d{2})/u);
    if(!start) continue;
    const place=Array.isArray(result.location)?result.location[0]:result.location;
    const label=place?.name||link.label;
    const online=/online|na daljavo/iu.test(label);
    const address=typeof place?.address==='string'?place.address:'';
    const titleText='Tečaj CPP — '+label.replace(/^Tečaj CPP\s*[-–]?\s*/iu,'');
    items.push({eventStatus:result.eventStatus,courseType:'CPP_UNSPECIFIED',text:titleText+' '+result.description,startDateText:start[3]+'.'+start[2]+'.'+start[1],endDateText:end?end[3]+'.'+end[2]+'.'+end[1]:null,timeText:'ob '+start[4]+(end?'-'+end[4]:''),titleText,categoryText:label,mode:online?'ONLINE':'CLASSROOM',explicitLocation:online?{name:'Na daljavo — Blisk',streetAddress:'',addressLocality:'Na daljavo'}:{name:address||label,streetAddress:address.split(',')[0],addressLocality:'Ljubljana'},registrationUrl:link.url,sourceEventId:link.url.split('/').at(-1)});
  }
  return {title:'Blisk — javni termini CPP',items};
}

async function collectFerdoPublicTerms(cdp,source) {
  const categories=await evaluate(cdp, `(() => Array.from(document.querySelectorAll('select[name="category_id"] option')).filter(n=>n.value).map(n=>({value:n.value,label:n.textContent.trim()})))()`);
  const items=[];
  for(const category of categories) {
    const url=new URL(source.url);url.searchParams.set('category_id',category.value);
    await assertRobotsAllowed({...source,url:url.href});
    await navigate(cdp,url.href,1200);
    const terms=await evaluate(cdp, `(() => Array.from(document.querySelectorAll('#termin-select option')).filter(n=>n.value).map(n=>({text:n.textContent.trim(),value:n.value})))()`);
    for(const term of terms) {
      const registrationUrl=new URL(url);registrationUrl.searchParams.set('termin_id',term.value);
      items.push({text:category.label+' '+term.text,titleText:'Tečaj CPP — '+category.label,categoryText:category.label,unknownTime:/ob 00:00\b/u.test(term.text),explicitLocation:{name:'Nova Gorica',streetAddress:'',addressLocality:'Nova Gorica'},registrationUrl:registrationUrl.href});
    }
  }
  return {title:'Ferdo — javna izbira kategorije in termina',items};
}

async function collectModriPublicTerms(cdp) {
  return evaluate(cdp, `(async()=>{
    const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const items=[];
    const labels=['V predavalnici','Online (Zoom)'].filter(label=>Array.from(document.querySelectorAll('button')).some(n=>n.innerText.trim()===label));
    if(!labels.length) labels.push(null);
    for(const label of labels) {
      const toggle=Array.from(document.querySelectorAll('button')).find(n=>n.innerText.trim()===label);
      if(label && (!toggle || toggle.disabled)) continue;
      if(toggle)toggle.click();await pause(1600);
      for(const node of document.querySelectorAll('button')) {
        const text=node.innerText.trim();
        if(!/\\b\\d{1,2}\\.\\s*[a-zč]+\\.?.*20\\d{2}/iu.test(text)||!/\\d{1,2}:\\d{2}/u.test(text)) continue;
        if(/termin poln/iu.test(text)) continue;
        const titleText='Tečaj CPP — B kategorija';
        const online=label==='Online (Zoom)' || /online|zoom|na daljavo/iu.test(text);
        const publishedPlace=text.split(/\\n/u).map(s=>s.trim()).find(s=>s.includes(',')&&!/20\\d{2}|Prijave do/iu.test(s));
        const classroomPlace=publishedPlace?{name:publishedPlace,streetAddress:publishedPlace.split(',')[0].trim(),addressLocality:publishedPlace.split(',').at(-1).trim()}:null;
        items.push({text,titleText,categoryText:titleText,mode:online?'ONLINE':'CLASSROOM',...(online?{explicitLocation:{name:'Na daljavo — Modrivoznik.si',streetAddress:'',addressLocality:'Na daljavo'}}:classroomPlace?{explicitLocation:classroomPlace}:{}),registrationUrl:location.href+'#prijava'});
      }
    }
    return {title:document.title,items};
  })()`);
}

async function harvestSource(cdp, source) {
  if (publicBrowserReviewSchools.has(source.school_id)) {
    const file = `data/public-browser-reviews/${source.school_id}.json`;
    if (!fs.existsSync(file)) throw new Error('Public browser review required; headless access is blocked');
    return reviewedPublicCapture(source, JSON.parse(fs.readFileSync(file, 'utf8')));
  }
  await assertRobotsAllowed(source);
  await navigate(cdp, source.url, [3063,3190].includes(source.school_id)?8000:3500);
  const expression = `(() => {
    const clean=value=>String(value||'').replace(/\\s+/gu,' ').trim();
    const selectors = ${JSON.stringify(source.selectors)};
    const maxNodes = ${source.max_nodes};
    const extractor = ${JSON.stringify(source.extractor || 'date-nodes-v1')};
    const schoolId = ${source.school_id};
    const named = new RegExp(${JSON.stringify(dateBearingNamedPattern)}, 'iu');
    const numeric = /\\b\\d{1,2}\\s*[.\\/-]\\s*\\d{1,2}\\s*[.\\/-]\\s*(?:20\\d{2}|\\d{2})\\b/u;
    const found = [];
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        let text = (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
        let item = { text };
        const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
        const precedingHeading = (start, pattern) => {
          for (let sibling = start.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
            const candidate = clean(sibling.innerText);
            if (/^H[1-6]$/u.test(sibling.tagName) && (!pattern || pattern.test(candidate))) return candidate;
          }
          return '';
        };
        if (schoolId === 3158) {
          const section=node.closest('.tr');
          const heading=clean(section?.querySelector('h3,h4,h5')?.textContent);
          if(!/CPP|predavanje.*kategorij/iu.test(heading))continue;
          // Maribor has its own approved source. Do not duplicate its snapshot.
          if(location.pathname.includes('/tecaji-cpp')&&/Maribor/iu.test(heading))continue;
          const additional=/Dopolnilno predavanje.*A kategorij/iu.test(heading);
          item.titleText=additional?'Dodatni del tečaja CPP — kategorije A1, A2, A':'Splošni del tečaja CPP';
          item.categoryText=additional?'A1, A2, A kategorije':'';
          item.courseType=additional?'CPP_ADDITIONAL':'CPP_GENERAL';
          item.registrationUrl=section?.querySelector('a[href*="/amzs-dogodki/"]')?.href||location.href;
        } else if (schoolId === 3133) {
          if(!/dne.*20\\d{2}/iu.test(text)) continue;
          item.titleText='Tečaj CPP — A, B, AM kategorije';
          item.categoryText=item.titleText;
          item.explicitLocation={name:'Učilnica v Kidričevem',streetAddress:'',addressLocality:'Kidričevo'};
          item.mode='CLASSROOM';
          item.registrationUrl=location.href;
        } else if (schoolId === 3174) {
          if(!/Pričetek CPP tečaja/iu.test(text)) continue;
          item.titleText='Splošni in dodatni del tečaja CPP — B kategorija';
          item.categoryText=item.titleText;
          item.unknownTime=true;
          item.explicitLocation={name:'Ulica Otona Župančiča 4, Črnomelj',streetAddress:'Ulica Otona Župančiča 4',addressLocality:'Črnomelj'};
          item.mode='CLASSROOM';
          item.registrationUrl=Array.from(document.querySelectorAll('a')).find(n=>/Prijava na (?:tečaj )?CPP/iu.test(n.innerText))?.href;
        } else if (schoolId === 3111) {
          if(!/Tečaj CPP/iu.test(text)) continue;
          const category=clean(node.querySelector('.single-news__name')?.innerText);
          const lines=Array.from(node.querySelectorAll('.right-col .d-flex')).map(n=>clean(n.innerText));
          const rawPlace=lines.find(s=>/^Šola vožnje/iu.test(s))||'';
          const locality=rawPlace.replace(/^Šola vožnje\\s*/iu,'').replace('Slov. Bistrica','Slovenska Bistrica').replace('Slov. Konjice','Slovenske Konjice');
          if(!category||!locality) continue;
          item.titleText='Tečaj CPP — kategorija '+category;
          item.categoryText=item.titleText;
          item.timeText=lines.find(s=>/^\\d{1,2}:\\d{2}$/u.test(s))||'';
          item.explicitLocation={name:locality,streetAddress:'',addressLocality:locality};
          item.mode=/splet/iu.test(locality)?'ONLINE':'CLASSROOM';
          item.registrationUrl=location.href+'#application-main';
        } else
 if (schoolId === 3097) {
          if (location.hostname.endsWith('siclj.si')) {
            const section=node.closest('.elementor-widget-text-editor');
            if(!/Tečaji CPP/iu.test(section?.innerText||'')) continue;
            item.titleText='Tečaj CPP na SIC Ljubljana';
            item.timeText=clean(section.innerText.match(/S pričetkom[^\\n]*/iu)?.[0]);
          } else {
            const category=clean(node.querySelector('.day')?.innerText);
            if(!/^Kategorija\\b/u.test(category)) continue;
            item.titleText='Tečaj CPP — '+category;
            item.categoryText=category;
            item.timeText='ob 16:30';
          }
          item.explicitLocation={name:'Ljubljana',streetAddress:'',addressLocality:'Ljubljana'};
          item.registrationUrl=location.href;
        } else if (schoolId === 3086) {
          if(!/^B kategorija/iu.test(clean(node.closest('.wpr-slider-content')?.textContent||''))) continue;
          item.lines=node.innerText || Array.from(node.childNodes).map(n=>n.nodeName==='BR'?'\\n':n.textContent).join('');
          item.titleText='Tečaj CPP — B kategorija';
          item.categoryText=item.titleText;
          item.mode='HYBRID';
          item.explicitLocation={name:'Parmova ulica 14, Ljubljana (učilnica/Zoom)',streetAddress:'Parmova ulica 14',addressLocality:'Ljubljana'};
        } else if (schoolId === 3087) {
          item.titleText=clean(node.querySelector('[data-hook="title"]')?.innerText);
          if(!/CPP TEČAJ/iu.test(item.titleText)) continue;
          item.categoryText=item.titleText;
          item.timeText=text.replace(/MED\\s+(\\d{1,2}\\.\\d{2})\\s+IN\\s+(\\d{1,2}\\.\\d{2})/iu,'od $1 do $2');
          item.timeText=item.timeText.match(/(?:OD|ob)\\s+\\d{1,2}[.:]\\d{2}(?:\\s*(?:DO|–|-)\\s*\\d{1,2}[.:]\\d{2})?/iu)?.[0]||'';
          item.explicitLocation={name:'Ljubljana',streetAddress:'',addressLocality:'Ljubljana'};
          item.registrationUrl=node.querySelector('a[data-hook="title"]')?.href;
        } else if (schoolId === 3118) {
          item.titleText=clean(node.querySelector('h3')?.innerText);
          if(!/tečaj CPP/iu.test(item.titleText)) continue;
          const place=clean(node.querySelector('h5')?.innerText);
          const lenart=/LENART/iu.test(place);
          item.explicitLocation={name:place,streetAddress:lenart?'Maistrova ulica 11':'Komenskega ulica 2',addressLocality:lenart?'Lenart':'Maribor'};
          item.registrationUrl=node.querySelector('a[href*="prijavnica"]')?.href;
        } else if (schoolId === 3063) {
          if(!/Tečaj CPP/iu.test(text)||!numeric.test(text)) continue;
          item.lines=node.innerText || Array.from(node.childNodes).map(n=>n.nodeName==='BR'?'\\n':n.textContent).join('');
          item.titleText='Tečaj CPP — B, A1, AM kategorije';
          item.categoryText=item.titleText;
          item.explicitLocation={name:'Petrov trg 7, Šempeter',streetAddress:'Petrov trg 7',addressLocality:'Šempeter'};
          item.registrationUrl=node.querySelector('a')?.href;
        } else if (schoolId === 3147) {
          text=clean(node.textContent);item.text=text;
          const card=node.closest('.elementor-icon-box-content');
          const section=node.closest('.e-child');
          const heading=(Array.from(section?.querySelectorAll('h1,h2,h3,h4,h5,h6')||[]).map(n=>clean(n.textContent)).find(s=>/KATEGORIJA/iu.test(s))||'').match(/KATEGORIJA.*$/iu)?.[0];
          const locality=clean(card?.querySelector('.elementor-icon-box-title')?.textContent);
          if(!heading||!locality||!numeric.test(text)) continue;
          item.titleText='Tečaj CPP — '+heading;
          item.categoryText=/B, AM IN A1/iu.test(heading)?'B, AM, A1 kategorije':heading;
          item.explicitLocation={name:locality,streetAddress:'',addressLocality:locality};
          item.registrationUrl=section?.querySelector('a[href*="prijav"]')?.href;
        } else if (schoolId === 3092) {
          if(!node.matches('.tp-term')) continue;
          item.titleText='Tečaj CPP za B kategorijo';
          item.categoryText=item.titleText;
          item.mode='HYBRID';
          item.explicitLocation={name:'Gerbičeva 44, Ljubljana (v živo ali online)',streetAddress:'Gerbičeva 44',addressLocality:'Ljubljana'};
          item.registrationUrl=location.href;
        } else
 if (schoolId === 3074) {
          if (!/^TEČAJ CPP (?:IZOLA|KOPER)/u.test(text)) continue;
          const locality=/CPP IZOLA/u.test(text)?'Izola':'Koper';
          item.titleText=text.split(/pričetek/iu)[0].trim();
          item.explicitLocation={name:locality,streetAddress:'',addressLocality:locality};
          item.registrationUrl=node.querySelector('a')?.href;
        } else if (schoolId === 3180) {
          if(!/^\\d{1,2}\\./u.test(text) || !/NASLEDNJI TEČAJ CPP/iu.test(precedingHeading(node))) continue;
          item.titleText='Tečaj CPP';
          item.explicitLocation={name:'Cesta pod Slivnico 24, Cerknica',streetAddress:'Cesta pod Slivnico 24',addressLocality:'Cerknica'};
          item.registrationUrl=new URL('/si/index.php/kontakt-sola-voznje-slavi',document.baseURI).href;
        } else if (schoolId === 3190) {
          const section = node.closest('.lokacija');
          const heading = section?.querySelector('h3');
          const locality = clean(heading?.innerText).replace(/^ALMA(?: PE)?\\s*/u, '');
          if (!/1\\. Srečanje:/iu.test(text)) continue;
          item.titleText = 'Tečaj CPP — splošni del in dodatni del B kategorije';
          const address = clean(heading?.getAttribute('title'));
          item.explicitLocation = { name:address || locality, streetAddress:address.split(',')[0] || '', addressLocality:locality };
          item.registrationUrl = new URL('/avtosola/prijava-na-tecaj', document.baseURI).href;
        } else if (schoolId === 3083) {
          if (!/kategorija/iu.test(text)) continue;
          const parts = [text];
          for (let next=node.nextSibling; next; next=next.nextSibling) {
            if (next.nodeType===1 && /^(?:U|B)$/u.test(next.tagName)) break;
            parts.push(next.textContent || '');
            if (next.nodeType===1 && next.matches('a[href^="https:"]') && !item.registrationUrl) item.registrationUrl = next.href;
          }
          let branch = '';
          for(let previous=node.previousSibling; previous; previous=previous.previousSibling) {
            if(previous.nodeType===1 && previous.tagName==='B' && /^\\s*\\*/u.test(previous.textContent)) { branch=clean(previous.textContent).replace(/^\\*\\s*|:$/gu,''); break; }
          }
          if (!branch) continue;
          branch=branch.toLocaleLowerCase('sl-SI').replace(/(^|\\s)(\\p{L})/gu,(_,space,letter)=>space+letter.toLocaleUpperCase('sl-SI'));
          item.titleText = 'Tečaj CPP — ' + text;
          text=clean(parts.join(' '));
          item.text=text;
          item.explicitLocation={ name:branch + (/možno tudi online/iu.test(text)?' (možno tudi na daljavo)':''), streetAddress:'', addressLocality:branch };
        } else if (schoolId === 3162) {
          const selectId=node.closest('select')?.id;
          const categories={'wpforms-2652-field_9':'B, AM','wpforms-2652-field_10':'A1, A2','wpforms-2652-field_15':'A','wpforms-2652-field_12':'C','wpforms-2652-field_13':'CE','wpforms-2652-field_14':'BE'};
          if (!categories[selectId]) continue;
          item.titleText='Tečaj CPP — kategorije '+categories[selectId];
          item.contextText=item.titleText;
          item.explicitLocation={name:'Maribor',streetAddress:'',addressLocality:'Maribor'};
          item.registrationUrl=location.href;
        } else if (schoolId === 3156) {
          item.titleText='Tečaj CPP — '+text.split(/\\b\\d/)[0];
          item.explicitLocation={name:'Ulica Jana Husa 1a, Ljubljana',streetAddress:'Ulica Jana Husa 1a',addressLocality:'Ljubljana'};
          item.registrationUrl=location.href;
        } else if (schoolId === 3188) {
          const card=node.closest('.slot-item');
          const category=clean(card?.querySelector('.slot-item__title')?.innerText).split(' ')[0];
          item.titleText='Tečaj CPP — kategorija '+category;
          item.contextText=item.titleText;
          item.text=item.titleText+' '+text;
          item.explicitLocation={name:'Maribor',streetAddress:'',addressLocality:'Maribor'};
          item.registrationUrl=card?.querySelector('.slot-item__footer a')?.href;
        } else if (schoolId === 3125) {
          const label=clean(node.textContent);
          const pieces=label.split(/\\s+-\\s+/u);
          const publishedDate=clean(node.getAttribute('rel')).replace('#',' ob ');
          item.titleText='Tečaj CPP — '+(pieces[1]||'');
          text=label+' '+publishedDate;
          item.text=text;
          item.explicitLocation={name:pieces[0],streetAddress:'',addressLocality:pieces[0]};
          item.registrationUrl=node.href;
        } else if (schoolId === 3056) {
          const cells=Array.from(node.querySelectorAll('td')).map(n=>clean(n.innerText));
          if(cells.length!==4) continue;
          const locality=/Slovenske Konjice/iu.test(cells[0])?'Slovenske Konjice':/Celje/iu.test(cells[0])?'Celje':'';
          if(!locality) continue;
          item.titleText='Tečaj CPP — kategorija '+cells[1];
          text=item.titleText+' '+cells[2]+' ob '+cells[3]; item.text=text;
          item.explicitLocation={name:cells[0],streetAddress:'',addressLocality:locality};
          item.registrationUrl=location.href+'#varna_voznja_list';
        } else if (schoolId === 3178) {
          const category=clean(node.previousElementSibling?.innerText);
          if (!/^Kategorija /u.test(category)) continue;
          item.titleText='Tečaj CPP — '+category;
          item.contextText=category;
          const locality=clean(node.querySelector('span[data-tina-field]:last-child')?.innerText);
          item.explicitLocation=locality?{name:locality,streetAddress:'',addressLocality:locality}:undefined;
          item.registrationUrl=location.href;
        } else if (schoolId === 3088) {
          const motor = node.closest('[role="tabpanel"]')?.getAttribute('aria-labelledby') === 'tab-motor';
          item.titleText = motor ? 'Tečaj CPP za motor' : 'Tečaj CPP za B kategorijo';
          item.timeText = text.replace(/^.*\\/\\s*(\\d{1,2})\\s*-\\s*(\\d{1,2})[.:](\\d{2}).*$/u, 'ob $1:00-$2:$3');
        } else if (schoolId === 3130) {
          text = clean(node.querySelector('a.title')?.innerText || text).split(/Kandidati morajo/iu)[0].trim();
          if (!/^V UČILNICI:/u.test(text)) continue;
          item.text = text;
          item.titleText = 'Tečaj CPP — ' + (text.match(/(?:OSNOVNI DEL in kategorija|Kategorija)\\s+[A-Z0-9]+/iu)?.[0] || '');
          item.registrationUrl = node.querySelector('a.title')?.href;
          item.mode = 'CLASSROOM';
        } else if (schoolId === 3150) {
          if (!/tečaj CPP/iu.test(text)) continue;
          item.titleText = 'Tečaj CPP';
        } else if (schoolId === 3073) {
          item.lines = node.innerText;
        } else if (schoolId === 3099) {
          item.titleText = clean(node.querySelector('h4')?.innerText);
          if (!/Tečaj CPP/iu.test(item.titleText)) continue;
          item.timeText = text.replace(/0b(?=\\s*\\d)/gu, 'ob');
          item.registrationUrl = node.querySelector('a.btn-sml')?.href;
        } else if (schoolId === 3116) {
          if (!/^CPP\\s*-/u.test(text)) continue;
          item.titleText = 'Tečaj CPP';
        } else if (schoolId === 3182) {
          const locality = clean(node.parentElement.querySelector('h1,h2,h3:not(.cpp2),h4')?.innerText || node.previousElementSibling?.innerText);
          if (!locality || /\\d/u.test(locality)) continue;
          item.titleText = 'Tečaj CPP — ' + locality;
          item.explicitLocation = { name:locality, streetAddress:'', addressLocality:locality };
        } else if (schoolId === 3151) {
          item.titleText = clean(node.querySelector('h2')?.innerText);
          if (!/Tečaj CPP/iu.test(item.titleText)) continue;
        } else if (schoolId === 3117) {
          item.titleText = 'Tečaj CPP';
          item.explicitLocation = { name:'TŠC Maribor', streetAddress:'', addressLocality:'Maribor' };
        } else if (schoolId === 3065) {
          item.titleText = 'Tečaj CPP';
        } else if (schoolId === 3120) {
          if (!/^Začetek tečaja:/iu.test(text)) continue;
          item.titleText = 'Tečaj CPP';
        } else if (schoolId === 3144) {
          if (!/lokacija/iu.test(text)) continue;
          item.titleText = 'Tečaj CPP';
          item.locationText = text.split(/lokacija\\s*/iu)[1] || '';
        } else if (schoolId === 3058) {
          if (!/termin predavanj CPP/iu.test(text)) continue;
          item.titleText = 'Tečaj CPP';
        } else if (schoolId === 3112) {
          if (!/organiziramo tečaj CPP/iu.test(text)) continue;
          item.titleText = 'Tečaj CPP in eCPP';
          item.mode = 'HYBRID';
          const section = node.closest('article,.entry-content') || node.parentElement;
          const sessions = Array.from(section.querySelectorAll('p')).map(n=>clean(n.innerText)).filter(s=>/^(?:Torek|Sreda|Četrtek|Ponedeljek|Petek),/iu.test(s)&&numeric.test(s));
          item.endDateText = sessions.at(-1);
          const details = clean(section.innerText);
          const hours = details.match(/med (\\d{1,2})\\. in (\\d{1,2})\\. uro/iu);
          if (hours) item.timeText = 'ob ' + hours[1] + ':00-' + hours[2] + ':00';
        } else if (schoolId === 3176) {
          if (node.matches('h3') && /pričetek naslednjega tečaja/iu.test(node.previousElementSibling?.innerText || '')) {
            item.titleText = 'Tečaj CPP — osnovni del in B kategorija';
          } else if (node.matches('p') && /^DODATNI DEL/iu.test(text)) {
            item.titleText = 'Dodatni del CPP — ' + text.split(':')[0].replace(/^DODATNI DEL\\s*/iu, '');
          } else if (node.matches('h4') && /^pričetek/iu.test(text)) {
            item.titleText = 'Dodatni del CPP — ' + precedingHeading(node, /KATEGORIJA/iu);
          } else continue;
          item.locationText = 'Novi trg 10, Novo mesto';
          const sessionDates = [];
          for (let sibling=node.nextElementSibling; sibling; sibling=sibling.nextElementSibling) {
            const detail = clean(sibling.innerText);
            if ((/^Dodatni del/iu.test(detail) && !(/osnovni del in B/iu.test(item.titleText) && /B[- ]+KAT/iu.test(detail))) || /^[A-Z0-9, ]+\\s*[–-]\\s*KATEGORIJA/iu.test(detail)) break;
            if (numeric.test(detail) && !/Zbor|vpis/iu.test(detail)) sessionDates.push(detail);
          }
          item.endDateText = sessionDates.at(-1);
        } else if (schoolId === 3159) {
          if (!/^\\d{1,2}\\.\\d{1,2}\\.20\\d{2}\\s+ob/u.test(text)) continue;
          item.titleText = 'Tečaj CPP';
        } else if (schoolId === 3142) {
          if (!/kategorija.*Lokacija:.*Ura:/iu.test(text)) continue;
          const pieces = text.split(/\\s+I\\s+/u);
          item.titleText = 'Tečaj CPP — ' + (pieces[2] || '');
          const place = text.match(/Lokacija:\\s*(.*?)\\s+I\\s+Ura:/iu)?.[1] || '';
          const parts = place.split(/-\\s*/u);
          if (parts.length === 2) item.explicitLocation = { name:parts[1] + ', ' + parts[0], streetAddress:parts[1], addressLocality:parts[0] };
          item.timeText = text.split(/Ura:/iu)[1] || '';
        } else if (schoolId === 3145) {
          if (!/^\\d{1,2}\\.\\d{1,2}\\.20\\d{2}\\s+ob/u.test(text)) continue;
          const section = node.closest('[data-testid="richTextElement"]');
          if (!/CPP TEČAJ/iu.test(section?.innerText || '')) continue;
          item.titleText = 'Tečaj CPP';
        } else if (schoolId === 3143) {
          if (!/Tečaj CPP/iu.test(text)) continue;
          item.titleText = text.match(/Tečaj CPP\\s*-\\s*kategorija\\s+[A-Z0-9]+/iu)?.[0] || 'Tečaj CPP';
          item.locationText = text.match(/Lokacija predavanja:\\s*(.*?)\\s+Prikaži lokacijo/iu)?.[1] || '';
        } else if (schoolId === 3179) {
          if (!/Splošni del|[A-Z]-kat\\./iu.test(text)) continue;
          item.titleText = 'Tečaj CPP — ' + text;
          item.explicitLocation = { name:'Postojna', streetAddress:'', addressLocality:'Postojna' };
        } else if (schoolId === 3169) {
          if (!/TEČAJ CPP.*NOV TEČAJ BO/iu.test(text)) continue;
          item.titleText = 'Tečaj CPP';
        } else if (schoolId === 3153) {
          if (!/Tečaj CPP/iu.test(text)) continue;
          const category = text.match(/Tečaj CPP\\s*-\\s*([A-Z0-9]+)/iu)?.[1];
          item.titleText = 'Tečaj CPP' + (category ? ' za ' + category + ' kategorijo' : '');
        } else if (schoolId === 3091) {
          if (!/CPP tečaj/iu.test(text)) continue;
          // The school's linked CPP programme explicitly names the classroom
          // and combined B course: https://stop.si/kako-do-vozniskega-2/
          item.titleText = 'Tečaj CPP — splošni del in dodatni del B kategorije';
          item.explicitLocation = { name:'Prušnikova ulica 57, Ljubljana-Šentvid', streetAddress:'Prušnikova ulica 57', addressLocality:'Ljubljana-Šentvid' };
        }
        if (schoolId === 3113 && node.matches('.table-row')) {
          item.titleText = node.querySelector('.col-title strong')?.innerText || '';
          item.timeText = 'ob ' + (node.querySelector('.col-time-1')?.innerText || '');
          item.locationText = node.querySelector('.col-place-1')?.innerText || '';
          item.priceText = node.querySelector('.col-title')?.innerText || '';
          item.mode = item.locationText ? 'CLASSROOM' : null;
        } else if (schoolId === 3129 && node.matches('.term-card')) {
          const section = node.closest('#termini-cpp');
          item.titleText = node.querySelector('.term-time')?.innerText || '';
          item.contextText = Array.from(section?.querySelectorAll('p') || []).map(p => p.innerText).find(t => /Tečaj poteka.*sedežu/iu.test(t)) || '';
          item.locationText = item.contextText.split(/\\.\\s+/u)[0];
          item.timeText = Array.from(section?.querySelectorAll('.value') || []).map(p => p.innerText).find(t => /začetek ob/iu.test(t)) || '';
          item.mode = item.contextText ? 'CLASSROOM' : null;
        } else if (schoolId === 3175 && node.matches('h3')) {
          const section = node.closest('.e-loop-item');
          const heading = section?.querySelector('h2')?.innerText || '';
          const parts = heading.split(/\\s+[–—]\\s+/u);
          if (parts.length === 2) item.locationText = parts[1] + ', ' + parts[0];
          item.titleText = node.nextElementSibling?.matches('h3') ? node.nextElementSibling.innerText : '';
          const context = [];
          for (let sibling = node.nextElementSibling; sibling && context.length < 6; sibling = sibling.nextElementSibling) {
            const detail = (sibling.innerText || '').trim();
            if (/^Dodatni del/iu.test(detail)) break;
            if (detail) context.push(detail);
          }
          item.contextText = context.join(' ');
          // The published gathering time is not asserted as the lesson start.
          item.suppressContextTime = true;
          item.mode = item.locationText ? 'CLASSROOM' : null;
        }
        if (extractor === 'relax-registration-v1') {
          const href = node instanceof HTMLAnchorElement ? node.href : '';
          if (!/\\/tip=(1|2)\\/c=\\1(?:\\/|$)/u.test(new URL(href, document.baseURI).pathname)) continue;
          const eventNode = node.closest('.post-thumbnail-content');
          const branchNode = node.closest('.comment')?.querySelector('a:not([href*="/termin="])');
          text = (eventNode?.innerText || '').replace(/\\s+/g, ' ').trim();
          item = { text, href: new URL(href, document.baseURI).href, branch: (branchNode?.innerText || '').replace(/\\s+/g, ' ').trim() };
          const plomosBranch=/pe-(?:velenje|mozirje)(?:\\/|$)/u.test(new URL(href).pathname);
          if (schoolId === 3137 && plomosBranch || schoolId === 3184 && !plomosBranch) continue;
        } else if (extractor === 'tilia-course-v1') {
          const prompt = node.closest('#nf-field-15-wrap')?.querySelector('.nf-field-label')?.innerText || '';
          text = [text, prompt].join(' ').replace(/\\s+/g, ' ').trim();
          item = { text };
        }
        if (!text || text.length > 800 || (!named.test(text) && !numeric.test(text))) continue;
        if (!found.some((existing) => (item.href || item.text) === (existing.href || existing.text) && item.titleText === existing.titleText)) found.push(item);
        if (found.length >= maxNodes) break;
      }
      if (found.length >= maxNodes) break;
    }
    return { title: document.title, items: found, ...(schoolId===3147?{diagnostics:{url:location.href,title:document.title,excerpt:clean(document.body?.innerText).slice(0,220),count:document.querySelectorAll('.elementor-icon-box-description').length,nodes:Array.from(document.querySelectorAll('.elementor-icon-box-description')).filter(n=>/20\\d{2}/u.test(n.textContent)).map(n=>({text:clean(n.textContent),place:clean(n.closest('.elementor-icon-box-content')?.querySelector('.elementor-icon-box-title')?.textContent),category:clean(n.closest('.e-child')?.querySelector('h2')?.textContent)}))}}:{}) };
  })()`;
  const collect = async () => source.school_id === 3064 ? await collectSmarcaPublicTerms(cdp)
    : source.school_id === 3096 ? await collectBliskPublicTerms(cdp,source)
    : source.school_id === 3172 ? await collectFerdoPublicTerms(cdp,source)
    : source.school_id === 3103 ? await collectModriPublicTerms(cdp)
    : await evaluate(cdp, expression);
  let result=await collect();
  for (let attempt = 0; result?.items?.length === 0 && attempt < ([3063,3190].includes(source.school_id)?20:8); attempt += 1) {
    await wait(1000);
    result = await collect();
  }
  if (!Array.isArray(result?.items) || result.items.length === 0) {
    throw new Error(`${source.school_name}: rendered page contained no date-bearing approved nodes; ${JSON.stringify(result?.diagnostics||{})}`);
  }
  const expandedItems = result.items.flatMap(item => publicCourseItems(source.school_id, item));
  const availableItems = expandedItems.filter((item) => !isUnavailableTerm(item.text));
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
    const courseLabel = item.courseType === 'CPP_ADDITIONAL' ? 'Dodatni del tečaja CPP' : item.courseType === 'CPP_GENERAL' ? 'Splošni del tečaja CPP' : 'Tečaj CPP';
    const title = item.titleText || courseLabel;
    const titleCategories = item.categoryText && !/kategorij|kat\./iu.test(title) ? ` · kategorije ${item.categoryText}` : '';
    const categoryLabel = item.categoryText ? ` Kategorije: ${item.categoryText}.` : '';
    // WordPress's existing JSON-LD adapter derives the mode from the title/place.
    const titleMode = item.mode === 'HYBRID' ? ' — v učilnici ali online' : item.mode === 'ONLINE' && !/online|zoom|na daljavo/iu.test(title) ? ' — online' : item.mode === 'CLASSROOM' && !/učilnic|v prostorih/iu.test(title) ? ' — v učilnici' : '';
    const modeLabel = item.mode === 'ONLINE' ? ' Izvedba na daljavo.' : item.mode === 'CLASSROOM' ? ' Izvedba v prostorih poslovalnice.' : '';
    const event = {
      "@context": "https://schema.org",
      "@type": "EducationEvent",
      "@id": item.sourceEventId ? `${source.url}#${item.sourceEventId}` : `${source.url}#vzi-browser-${crypto.createHash("sha256").update(item.identityText || item.text).digest("hex").slice(0, 16)}`,
      // The school name is separate: e.g. "Alfa-B" is not category B.
      name: `${title}${titleCategories}${titleMode}`,
      organizer: { "@type": "EducationalOrganization", name: source.school_name },
      description: `${item.text}.${categoryLabel}${modeLabel}`.replace(/\\s+/g, ' ').trim(),
      startDate: item.dates.startDate + (item.times.startTime ? `T${item.times.startTime}` : ""),
      url: source.url,
      inLanguage: "sl"
    };
    if (item.eventStatus) event.eventStatus=item.eventStatus;
    if (item.registrationUrl || item.priceAmount !== null && item.priceAmount !== undefined) {
      event.offers = { "@type": "Offer", url: item.registrationUrl || source.url, availability: "https://schema.org/InStock" };
      if (item.priceAmount !== null && item.priceAmount !== undefined) {
        event.offers.price = item.priceAmount;
        event.offers.priceCurrency = "EUR";
      }
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
  return { html, nodeCount: payloadItems.length, skippedUnavailable: expandedItems.length - availableItems.length };
}


function censusLinkScore(link) {
  const value = [link.text, link.url, link.nearby].filter(Boolean).join(' ');
  const direct = [link.text, link.url].filter(Boolean).join(' ');
  if (/mailto:|tel:|javascript:|\/login|\/wp-admin|shareArticle|\/share\b|prijavitelj|koda.?95|temeljnih.?kvalifikacij|tahograf|ADR\b|prv[aeo].?pomo|varn[aoe].?vožnj|gradivo|testi.in|izpitn[ei].?rok|zascita|zaščita/iu.test(direct)) return -100;
  let score = /cpp|cestno.?promet/iu.test(direct) ? 100 : /prijav/iu.test(direct) ? 55 : /termin|urnik|tečaj|tecaj/iu.test(direct) ? 35 : 0;
  if (/CPP|cestno.?promet/iu.test(link.nearby || '')) score += 25;
  if (/event-details|prijav|termin|urnik/iu.test(direct)) score += 15;
  if (/\.pdf(?:[?#]|$)/iu.test(link.url || '') && /cpp|cestno|tečaj|tecaj|urnik|termin/iu.test(value)) score += 35;
  return score;
}

function censusCourseEvidence(text, context = '') {
  if (/poslavlja|zaključ(?:ek|ujemo|uje).{0,30}delovan|izpisni list|prenehanj.{0,30}delovan|prijave.{0,20}do:|rok.{0,15}prijav/iu.test(text)) return false;
  return /\bCPP\b|cestno.?promet/iu.test(text + ' ' + context);
}

function censusDOMObservation() {
  const clean = value => String(value || '').replace(/\s+/gu,' ').trim();
  const body = clean(document.body?.innerText);
  const blocked = /security verification|verification could not be completed|verify.{0,30}(?:human|browser)|checking your browser|please wait while your request is being verified|access denied|just a moment/iu.test(body.slice(0,1600));
  const loginWall = body.length < 2500 && /log in to (?:continue|facebook)|you must log in|prijavite se za nadaljevanje/iu.test(body);
  const dated = /\b\d{1,2}\s*[.\/-]\s*\d{1,2}\s*[.\/-]\s*(?:20\d{2}|\d{2})\b|\b\d{1,2}\.?\s*(?:jan|feb|mar|apr|maj|jun|jul|avg|sep|okt|nov|dec)[a-zč]*\.?\s*,?\s*20\d{2}\b/iu;
  const shortDate = /\b\d{1,2}\.\s*(?:\d{1,2}\.|jan|feb|mar|apr|maj|jun|jul|avg|sep|okt|nov|dec)/iu;
  const nodes = [], yearless = [];
  if (!blocked && !loginWall) for (const node of document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,label,option,button,td,tr,div,span,time')) {
    if (/^(?:DIV|SPAN)$/u.test(node.tagName) && node.children.length > 6) continue;
    if (node.closest('script,style,nav,footer,#wpadminbar')) continue;
    let text = clean(node.innerText || node.textContent);
    if (!text || text.length > 1100 || (!dated.test(text) && !shortDate.test(text))) continue;
    let heading = '';
    for (let parent=node,depth=0; parent && depth<4 && !heading;parent=parent.parentElement,depth++) {
      for(let previous=parent.previousElementSibling;previous;previous=previous.previousElementSibling) {
        if (/^H[1-6]$/u.test(previous.tagName)) {heading=clean(previous.innerText);break;}
      }
    }
    const nearby = clean(node.parentElement?.innerText).slice(0,1300);
    const selector = node.id ? '#'+CSS.escape(node.id) : node.tagName.toLowerCase()+Array.from(node.classList).slice(0,3).map(x=>'.'+CSS.escape(x)).join('');
    const item={text,heading,selector,nearby};
    const list=dated.test(text)?nodes:yearless;
    if(!list.some(x=>x.text===text)) list.push(item);
    if(nodes.length>=100) break;
  }
  const links=Array.from(document.querySelectorAll('a[href],iframe[src]')).map(node=>({
    text:clean(node.textContent || node.getAttribute('title')).slice(0,160),
    url:node.tagName==='IFRAME'?node.src:node.href,
    nearby:clean(node.parentElement?.innerText).slice(0,600),
    kind:node.tagName==='IFRAME'?'iframe':'link'
  })).filter(x=>/^https?:/u.test(x.url)&&!/recaptcha|googletagmanager|doubleclick|youtube|google\.com\/maps/iu.test(x.url)).filter(x=>/cpp|cestno|prijav|termin|urnik|tečaj|tecaj|\.pdf\b/iu.test(x.text+' '+x.url+' '+x.nearby));
  const images=Array.from(document.querySelectorAll('img[src]')).map(node=>({url:node.currentSrc||node.src,alt:clean(node.alt),nearby:clean(node.parentElement?.innerText).slice(0,650)})).filter(x=>/^https?:/u.test(x.url)&&/CPP|cestno|urnik|termin|tečaj|tecaj|20(?:26|27)/iu.test(x.alt+' '+x.nearby+' '+x.url)&&!/logo|icon|avatar|placeholder/iu.test(x.alt+' '+x.url)).slice(0,20);
  const structured=[];
  for(const node of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const walk=value=>{if(Array.isArray(value)){for(const x of value)walk(x);return;}if(!value||typeof value!=='object')return;if(value.startDate&&/Event/iu.test(String(value['@type'])))structured.push({name:clean(value.name),startDate:value.startDate,endDate:value.endDate,url:value.url,location:value.location});for(const x of Object.values(value))if(x&&typeof x==='object')walk(x);};
      walk(JSON.parse(node.textContent));
    } catch {}
  }
  return {url:location.href,title:document.title,ready:document.readyState,blocked,loginWall,nodes,yearless:yearless.slice(0,25),links,images,structured:structured.slice(0,60),text_excerpt:body.slice(0,350)};
}

async function censusPublicPdf(source, url) {
  await assertRobotsAllowed({...source,url});
  const response=await fetch(url,{headers:{'User-Agent':userAgent,Accept:'application/pdf'},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('PDF HTTP '+response.status);
  if(Number(response.headers.get('content-length')||0)>15000000)throw new Error('PDF exceeds 15 MB');
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>15000000 || bytes.subarray(0,5).toString()!=='%PDF-')throw new Error('Not a supported public PDF');
  return new Promise((resolve,reject)=>{
    const child=spawn('pdftotext',['-layout','-','-'],{stdio:['pipe','pipe','pipe']});
    const chunks=[];let size=0;let error='';
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('PDF text extraction timeout'));},15000);
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.stdout.on('data',data=>{size+=data.length;if(size<800000)chunks.push(data);});
    child.stderr.on('data',data=>{error+=data.toString().slice(0,200);});
    child.on('close',code=>{clearTimeout(timer);if(code!==0)reject(new Error('PDF text extraction failed: '+error));else resolve(Buffer.concat(chunks).toString('utf8'));});
    child.stdin.on('error',()=>{});child.stdin.end(bytes);
  });
}

async function auditCandidateSites() {
  const candidates=JSON.parse(fs.readFileSync('config/cpp-browser-candidates.json','utf8'));
  if(!Array.isArray(candidates)||candidates.length>500)throw new Error('Invalid candidate inventory');
  const maxPages=positiveInteger(process.env.VZI_CPP_CENSUS_MAX_PAGES,8,'VZI_CPP_CENSUS_MAX_PAGES');
  const workers=Math.min(4,positiveInteger(process.env.VZI_CPP_CENSUS_WORKERS,3,'VZI_CPP_CENSUS_WORKERS'));
  const runtimes=await Promise.all(Array.from({length:workers},()=>startChrome()));
  const results=new Array(candidates.length);let cursor=0,completed=0;
  const record=(index,result)=>{results[index]=result;completed++;};
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'Europe/Ljubljana'});
  try {
    await Promise.all(runtimes.map(async runtime=>{
     while(cursor<candidates.length) {
      const sourceIndex=cursor++;const source=candidates[sourceIndex];
      const result={school_id:source.school_id,school_name:source.school_name,source_url:source.url,pages:[],errors:[],pages_read:0,status:'READ_FAILED'};
      if(!source.url){result.status='WEBSITE_NOT_VERIFIED';record(sourceIndex,result);continue;}
      if(publicBrowserReviewSchools.has(source.school_id)){
        result.status='PUBLIC_BROWSER_REVIEW_REQUIRED';
        result.errors.push({url:source.url,error:'Headless security verification failed; use a dated normal public browser review without bypassing verification'});
        record(sourceIndex,result);continue;
      }
      const queue=[{url:source.url,score:1000,kind:'link'}],seen=new Set(),allowedHosts=new Set([new URL(source.url).hostname.replace(/^www\./u,'')]),blockedHosts=new Set();
      let externalHosts=0;
      while(queue.length&&seen.size<maxPages) {
        queue.sort((a,b)=>b.score-a.score);
        const candidate=queue.shift();const url=candidate.url;
        if(seen.has(url))continue;seen.add(url);
        const host=new URL(url).hostname.replace(/^www\./u,'');
        if(blockedHosts.has(host))continue;
        try {
          if(/\.pdf(?:[?#]|$)/iu.test(url)) {
            const text=await censusPublicPdf(source,url);
            const lines=text.split(/\n/u),nodes=[];
            for(let i=0;i<lines.length;i++) {
              const context=lines.slice(Math.max(0,i-2),Math.min(lines.length,i+3)).join(' ').replace(/\s+/gu,' ').trim();
              if(canonicalDateRange(lines[i])&&censusCourseEvidence(context))nodes.push({text:context.slice(0,1000),date:canonicalDateRange(lines[i])});
            }
            const upcoming=nodes.filter(x=>x.date.startDate>=today);
            result.pages.push({url,kind:'pdf',title:'Public PDF',upcoming:upcoming.slice(0,25),dated_cpp_count:nodes.length,text_available:!!text.trim()});
            if(upcoming.length)result.status='UPCOMING_EVIDENCE';
            continue;
          }
          await assertRobotsAllowed({...source,url});
          await Promise.race([navigate(runtime.cdp,url,2600),wait(18000).then(()=>{throw new Error('Navigation timeout');})]);
          const expression='('+censusDOMObservation.toString()+')()';
          let page=await evaluate(runtime.cdp,expression);
          if(!page||page.url?.startsWith('chrome-error:'))throw new Error('Public page did not load');
          if(!page.blocked&&!page.loginWall&&(page.ready!=='complete'||page.nodes.length===0)) {await wait(3000);page=await evaluate(runtime.cdp,expression);}
          if(page.blocked||page.loginWall){blockedHosts.add(host);result.pages.push({url:page.url,title:page.title,blocked:page.blocked,login_required:page.loginWall});continue;}
          const finalUrl=new URL(page.url);allowedHosts.add(finalUrl.hostname.replace(/^www\./u,''));
          const parsed=page.nodes.map(node=>({...node,date:canonicalDateRange(node.text)})).filter(node=>node.date&&censusCourseEvidence(node.text,node.heading+' '+node.nearby+' '+page.title));
          const upcoming=parsed.filter(node=>node.date.startDate>=today);
          const yearless=page.yearless.filter(node=>censusCourseEvidence(node.text,node.heading+' '+node.nearby+' '+page.title));
          const links=page.links.map(link=>({...link,score:censusLinkScore(link)})).filter(link=>link.score>=50).sort((a,b)=>b.score-a.score);
          result.pages.push({url:page.url,title:page.title,upcoming:upcoming.slice(0,25),other_dated_count:parsed.length-upcoming.length,yearless:yearless.slice(0,12),images:page.images,structured_events:page.structured,cpp_links:links.slice(0,25)});
          if(upcoming.length)result.status='UPCOMING_EVIDENCE';
          // A published date never stops traversal: linked forms can contain other courses.
          if(result.pages.length===1) {
            const home=new URL(finalUrl.href);home.search='';home.hash='';home.pathname=/\.wixsite\.com$/u.test(home.hostname)?'/'+home.pathname.split('/').filter(Boolean)[0]+'/':'/';
            if(home.href!==finalUrl.href&&!seen.has(home.href))queue.push({url:home.href,score:65,kind:'link'});
          }
          for(const link of links) {
            let target;try{target=new URL(link.url);}catch{continue;}
            target.hash='';
            if(seen.has(target.href)||queue.some(x=>x.url===target.href))continue;
            if(/(?:\/user\b|\/login\b|\/wp-admin\b|prijava-uporabnika)/iu.test(target.pathname))continue;
            const targetHost=target.hostname.replace(/^www\./u,'');
            if(!allowedHosts.has(targetHost)) {
              if(externalHosts>=2||link.score<100||/gov\.si$|e-uprava|facebook|instagram|tiktok|twitter|youtube/iu.test(targetHost))continue;
              // Only explicitly linked public CPP destinations; no private RPO or login.
              allowedHosts.add(targetHost);externalHosts++;
            }
            if(/\.wixsite\.com$/u.test(target.hostname)&&target.pathname.split('/').filter(Boolean)[0]!==finalUrl.pathname.split('/').filter(Boolean)[0])continue;
            queue.push({...link,url:target.href});
          }
        } catch(error) {
          const message=String(error?.message||error).slice(0,300);result.errors.push({url,error:message});
          if(/robots\.txt/iu.test(message))blockedHosts.add(host);
          if (/Chrome CDP (?:timeout|connection closed)/u.test(message)) {
            // A dead renderer must not stop the national inventory crawl.
            try{runtime.child.kill('SIGKILL');runtime.cdp.close();}catch{}
            try{fs.rmSync(runtime.profile,{recursive:true,force:true,maxRetries:4,retryDelay:250});}catch{}
            Object.assign(runtime,await startChrome());
          } else {
            try{await runtime.cdp.call('Page.stopLoading');}catch{}
          }
        }
      }
      if(result.status!=='UPCOMING_EVIDENCE') {
        const readable=result.pages.filter(p=>!p.blocked&&!p.login_required);
        result.status=readable.length?'NO_CONFIRMED_FUTURE_CPP_IN_READ_PAGES':result.pages.some(p=>p.blocked||p.login_required)?'VERIFICATION_OR_LOGIN_REQUIRED':result.errors.some(e=>/robots\.txt/iu.test(e.error))?'ROBOTS_RESTRICTED':'READ_FAILED';
      }
      result.pages_read=result.pages.filter(p=>!p.blocked&&!p.login_required).length;
      result.unread_linked_pages=queue.length;
      record(sourceIndex,result);
      process.stdout.write(JSON.stringify({audit_progress:completed,total:candidates.length,school_id:source.school_id,pages:result.pages_read,status:result.status})+'\n');
      await wait(250);
     }
    }));
    const output={generated_at:new Date().toISOString(),source_count:results.length,max_pages_per_school:maxPages,workers,methodology:'Read-only public HTML, linked registration pages, structured events, image evidence and text PDFs. Dates are associated with CPP context; evidence requires verification before publication.',results};
    fs.mkdirSync('build',{recursive:true});fs.writeFileSync('build/cpp-source-audit.json',JSON.stringify(output,null,2)+'\n');
    process.stdout.write(JSON.stringify({audit:'COMPLETE',source_count:results.length,pages_read:results.reduce((n,r)=>n+r.pages_read,0),upcoming_evidence:results.filter(r=>r.status==='UPCOMING_EVIDENCE').length})+'\n');
  } finally {
    await Promise.all(runtimes.map(async runtime=>{
      try{await runtime.cdp.call('Browser.close');}catch{runtime.child.kill('SIGKILL');}
      runtime.cdp.close();await wait(250);if(runtime.child.exitCode===null)runtime.child.kill('SIGKILL');
      fs.rmSync(runtime.profile,{recursive:true,force:true,maxRetries:8,retryDelay:250});
    }));
  }
}

if (process.argv.includes("--audit-candidates")) {
  await auditCandidateSites();
  process.exit(0);
}

const runtime = await startChrome();
const results = [];
let observations = [];
const maxSources = positiveInteger(process.env.VZI_CPP_MAX_SOURCES_PER_RUN, 20, "VZI_CPP_MAX_SOURCES_PER_RUN");
const defaultRotationSlot = Math.floor(Date.now() / 86400000);
const rotationSlot = nonNegativeInteger(process.env.VZI_CPP_ROTATION_SLOT, defaultRotationSlot, "VZI_CPP_ROTATION_SLOT");
const refreshArgument=process.argv.find(v=>v.startsWith('--refresh-school='));
const refreshSchool=refreshArgument?Number(refreshArgument.split('=')[1]):null;
if(refreshArgument&&(!Number.isSafeInteger(refreshSchool)||refreshSchool<=0))throw new Error('Invalid refresh school');
const batch = selectHarvestBatch(refreshSchool?registry.sources.filter(s=>s.school_id===refreshSchool):registry.sources, maxSources, rotationSlot);
try {
  for (const source of batch.selected) {
    try {
      const harvested = await harvestSource(runtime.cdp, source);
      const observedAt = harvested.observedAt || new Date().toISOString();
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
        method: harvested.method || "public_headless_browser",
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
    process.stdout.write(JSON.stringify({harvest_failures:results})+"\n");
    throw new Error("No approved browser source produced a publishable observation");
  }
  const signingKey = process.env.VZI_CPP_MANIFEST_SIGNING_KEY;
  if (!signingKey) throw new Error('Missing secret: VZI_CPP_MANIFEST_SIGNING_KEY');
  if(refreshSchool){
    const previous=JSON.parse(fs.readFileSync('data/cpp-browser-observations.json','utf8'));
    observations=reuseVerifiedObservations(previous,observations,registry,crypto.createPublicKey(signingKey),Date.now(),refreshSchool);
  }
  const generatedAt = new Date().toISOString();
  const manifest = {
    version: 2,
    generated_at: generatedAt,
    registry,
    registry_sha256: crypto.createHash("sha256").update(registryCanonical).digest("hex"),
    observations
  };
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
  // Chromium can briefly keep profile files open after Browser.close. Node's
  // recursive removal otherwise fails nondeterministically with ENOTEMPTY and
  // turns a successfully signed harvest into a failed workflow.
  fs.rmSync(runtime.profile, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 250
  });
}
