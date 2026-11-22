import fs from 'node:fs';

export function coverageReport(candidates, registry, manifest, audit, now = new Date()) {
  const today = now.toLocaleDateString('en-CA', {timeZone: 'Europe/Ljubljana'});
  const cutOff = now.getTime() - 7 * 86400000;
  const rows = candidates.map(school => {
    const sources = registry.sources.filter(s => Number(s.school_id) === Number(school.school_id) && s.enabled && s.approved);
    const observations = (manifest.observations || []).filter(o => Number(o.school_id) === Number(school.school_id));
    const fresh = observations.filter(o => Date.parse(o.observed_at) >= cutOff && Date.parse(o.observed_at) <= now.getTime());
    const evidence = (audit.results || []).find(r => Number(r.school_id) === Number(school.school_id));
    const observedDates = new Set();
    const observedRanges = [];
    for (const observation of fresh) {
      for (const match of String(observation.rendered_html || '').matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/giu)) {
        const walk = value => {
          if (Array.isArray(value)) { value.forEach(walk); return; }
          if (!value || typeof value !== 'object') return;
          if (/Event/u.test(String(value['@type'])) && /^20\d{2}-\d{2}-\d{2}/u.test(value.startDate || '')) {
            const start = value.startDate.slice(0, 10);
            const end = /^20\d{2}-\d{2}-\d{2}/u.test(value.endDate || '') ? value.endDate.slice(0, 10) : start;
            observedDates.add(start);
            observedRanges.push({start, end: end >= start ? end : start});
          }
          Object.values(value).filter(v => v && typeof v === 'object').forEach(walk);
        };
        try { walk(JSON.parse(match[1])); } catch { /* malformed evidence is never a confirmed course */ }
      }
    }
    const evidenceDates = new Set((evidence?.pages || []).flatMap(page => (page.upcoming || []).map(item => item.date?.startDate)).filter(date => /^20\d{2}-\d{2}-\d{2}$/u.test(date || '') && date >= today));
    // Later lecture days inside an already observed course are not extra courses.
    const missingDates = [...evidenceDates].filter(date => !observedRanges.some(range => range.start <= date && date <= range.end)).sort();
    const missingSources = sources.filter(source => !fresh.some(o => o.source_url === source.url)).map(s => s.url);
    const futureDates = [...observedDates].filter(date => date >= today).sort();
    const actions = [];
    if (!school.url) actions.push('FIND_OFFICIAL_WEBSITE');
    if (missingDates.length) actions.push('REVIEW_UNIMPORTED_DATE_EVIDENCE');
    if (missingSources.length) actions.push('RECHECK_MISSING_OR_STALE_SOURCE');
    if (sources.length === 0 && school.url) actions.push('FIND_PUBLISHABLE_SOURCE');
    if (evidence?.pending_pages?.length || evidence?.unread_linked_pages) actions.push('CONTINUE_UNREAD_PAGES');
    if (/VERIFICATION|ROBOTS|BROWSER_REVIEW|READ_FAILED/u.test(evidence?.status || '')) actions.push('REVIEW_ACCESS_LIMIT');
    if (!evidence || Date.parse(audit.generated_at) < cutOff) actions.push('REFRESH_WEBSITE_AUDIT');
    if (!futureDates.length && sources.length) actions.push('CHECK_FOR_NEW_FUTURE_COURSES');
    return {
      school_id: school.school_id, school_name: school.school_name, official_url: school.url || '',
      approved_sources: sources.length, fresh_observations: fresh.length,
      latest_observed_at: observations.map(o => o.observed_at).sort().at(-1) || null,
      future_dates_in_manifest: futureDates, unmatched_date_evidence: missingDates,
      missing_observation_sources: missingSources, audit_status: evidence?.status || 'NOT_AUDITED',
      pages_read: evidence?.pages_read || 0, pending_pages: evidence?.pending_pages?.length || evidence?.unread_linked_pages || 0,
      actions
    };
  });
  return {
    generated_at: now.toISOString(), audit_generated_at: audit.generated_at || null,
    methodology: 'Discovery worklist for every directory school. Date evidence outside an observed course interval is a review lead, never publication approval or proof of a missing course. Dates inside an observed interval may still belong to other courses; inspect all linked pages and identities. Manifest dates are not a verified WordPress public event count. Failed or stale reads do not mean the school has no courses.',
    summary: {
      schools: rows.length, schools_with_website: rows.filter(r => r.official_url).length,
      approved_sources: rows.reduce((sum, row) => sum + row.approved_sources, 0),
      schools_with_fresh_observation: rows.filter(r => r.fresh_observations).length,
      schools_needing_website_discovery: rows.filter(r => !r.official_url).length,
      schools_with_unmatched_date_evidence: rows.filter(r => r.unmatched_date_evidence.length).length,
      schools_with_unread_pages: rows.filter(r => r.pending_pages).length,
      schools_with_missing_or_stale_source: rows.filter(r => r.missing_observation_sources.length).length
    }, schools: rows
  };
}

if (process.argv.includes('--self-test')) {
  const assert = (value, label) => { if (!value) throw new Error(label); };
  const schools = [{school_id: 1, school_name: 'One', url: 'https://one.example/'}, {school_id: 2, school_name: 'Two', url: ''}];
  const registry = {sources: [{school_id: 1, url: 'https://one.example/', approved: true, enabled: true}]};
  const manifest = {observations: [{school_id: 1, source_url: 'https://one.example/', observed_at: '2026-11-21T10:00:00Z', rendered_html: '<script type="application/ld+json">[{"@type":"EducationEvent","startDate":"2026-12-01","endDate":"2026-12-06"}]</script>'}]};
  const audit = {generated_at: '2026-11-22T00:00:00Z', results: [{school_id: 1, pages: [{upcoming: [{date: {startDate: '2026-12-01'}}, {date: {startDate: '2026-12-03'}}, {date: {startDate: '2026-12-08'}}]}], pending_pages: [{url:'https://one.example/cpp'}]}]};
  const now = new Date('2026-11-22T10:00:00Z');
  const result = coverageReport(schools, registry, manifest, audit, now);
  assert(result.schools.length === 2 && result.summary.schools_needing_website_discovery === 1, 'all schools, including no website');
  assert(result.schools[0].unmatched_date_evidence.join() === '2026-12-08', 'course intervals suppress repeated lecture days, while new dates remain flagged');
  assert(result.schools[0].actions.includes('CONTINUE_UNREAD_PAGES'), 'continuation worklist');
  manifest.observations[0].observed_at = '2026-11-01T10:00:00Z';
  const stale = coverageReport(schools, registry, manifest, audit, now);
  assert(stale.summary.schools_with_fresh_observation === 0 && stale.summary.schools_with_missing_or_stale_source === 1, 'observation freshness is not manifest generation time');
  console.log('CPP coverage report PASS: full roster, date evidence gaps, unread pages and stale observations.');
} else if (process.argv[1]?.endsWith('/report-cpp-coverage.mjs')) {
  const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  const report = coverageReport(read('config/cpp-browser-candidates.json'), read('config/cpp-browser-sources.json'), read('data/cpp-browser-observations.json'), read('data/cpp-source-audit.json'));
  fs.mkdirSync('build', {recursive:true});
  fs.writeFileSync('build/cpp-coverage.json', JSON.stringify(report, null, 2) + '\n');
  const fields = ['school_id', 'school_name', 'official_url', 'approved_sources', 'fresh_observations', 'latest_observed_at', 'audit_status', 'pages_read', 'pending_pages', 'unmatched_date_evidence', 'missing_observation_sources', 'actions'];
  const quote = value => '"' + String(Array.isArray(value) ? value.join(' | ') : value ?? '').replaceAll('"', '""') + '"';
  fs.writeFileSync('build/cpp-coverage.csv', '\uFEFF' + [fields.map(quote).join(';'), ...report.schools.map(row => fields.map(field => quote(row[field])).join(';'))].join('\n') + '\n');
  console.log(JSON.stringify(report.summary));
}
