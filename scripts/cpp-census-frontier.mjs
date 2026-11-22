// Public links found on school pages are evidence for discovery, never publication.
export function weeklyPageBudget(now = new Date()) {
  return now.getUTCDay() === 1 ? 24 : 8;
}

export function censusSiteUrl(raw, sourceUrl) {
  try {
    const url = new URL(raw);
    const source = new URL(sourceUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if (url.hostname.replace(/^www\./u, '') !== source.hostname.replace(/^www\./u, '')) return null;
    if (url.port && !['80', '443'].includes(url.port)) return null;
    const decoded = decodeURIComponent(url.pathname);
    if (/(?:^|\/)(?:wp-admin|wp-login\.php|login|logout|account|my-account|checkout|cart|user|prijava-uporabnika)(?:\/|$)/iu.test(decoded)) return null;
    if (Array.from(url.searchParams.keys()).some(key => /token|nonce|password|secret|session|auth|email/iu.test(key))) return null;
    // Wix hosts contain independent schools; preserve the school's site prefix.
    if (/\.wixsite\.com$/u.test(source.hostname) && url.pathname.split('/').filter(Boolean)[0] !== source.pathname.split('/').filter(Boolean)[0]) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}

export function resumeCensusFrontier(previous, source) {
  if (!previous || Number(previous.school_id) !== Number(source.school_id) || previous.source_url !== source.url) return [];
  const seen = new Set();
  const visited = new Set((previous.pages || []).map(page => censusSiteUrl(page.url, source.url)).filter(Boolean));
  const pending = Array.isArray(previous.pending_pages) ? previous.pending_pages : (previous.pages || []).flatMap(page =>
    (page.cpp_links || []).map(link => ({url: link.url, discovered_on: page.url}))
  ).filter(item => !visited.has(censusSiteUrl(item.url, source.url)));
  return pending.flatMap(item => {
    // Only same-site links from the immediately preceding audit may be resumed.
    const url = censusSiteUrl(item.url, source.url);
    if (!url || seen.has(url) || !censusSiteUrl(item.discovered_on, source.url)) return [];
    seen.add(url);
    return [{url, score: 250, kind: /\.pdf(?:[?#]|$)/iu.test(url) ? 'pdf' : 'link', discovered_on: item.discovered_on}];
  }).slice(0, 100);
}

export function saveCensusFrontier(queue, source, blockedHosts = new Set()) {
  const seen = new Set();
  return queue.flatMap(item => {
    const url = censusSiteUrl(item.url, source.url);
    if (!url || seen.has(url) || !censusSiteUrl(item.discovered_on, source.url) || blockedHosts.has(new URL(url).hostname.replace(/^www\./u, ''))) return [];
    seen.add(url);
    return [{url, discovered_on: item.discovered_on}];
  }).slice(0, 100);
}
