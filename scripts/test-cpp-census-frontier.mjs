import assert from 'node:assert/strict';
import {censusSiteUrl, resumeCensusFrontier, saveCensusFrontier, weeklyPageBudget} from './cpp-census-frontier.mjs';

const source = {school_id: 1, url: 'https://school.example/cpp/'};
const queue = Array.from({length: 32}, (_, i) => ({url: `https://school.example/cpp/course-${i}`, discovered_on: source.url}));
// Simulate three bounded audits of a site with more pages than a daily budget.
let pending = queue;
const visited = new Set();
for (let run = 0; run < 4; run++) {
  const resumed = resumeCensusFrontier({school_id: 1, source_url: source.url, pending_pages: pending}, source);
  for (const item of resumed.slice(0, 8)) visited.add(item.url);
  pending = saveCensusFrontier(resumed.slice(8), source);
}
assert.equal(visited.size, 32, 'all pages are eventually visited, instead of repeating the first eight');
assert.equal(pending.length, 0);
assert.equal(resumeCensusFrontier({school_id: 1, source_url: source.url, pages: [{url: source.url, cpp_links: [{url: source.url}, {url: queue[0].url}]}]}, source).length, 1, 'upgrade resumes unread links in older audits');
assert.equal(weeklyPageBudget(new Date('2026-11-23T02:17:00Z')), 24);
assert.equal(weeklyPageBudget(new Date('2026-11-22T02:17:00Z')), 8);
assert.deepEqual(resumeCensusFrontier({school_id: 2, source_url: source.url, pending_pages: queue}, source), []);
assert.deepEqual(resumeCensusFrontier({school_id: 1, source_url: 'https://old.example/', pending_pages: queue}, source), []);
assert.equal(saveCensusFrontier([...queue, ...queue], source).length, 32);
assert.deepEqual(saveCensusFrontier(queue, source, new Set(['school.example'])), []);
for (const url of ['https://other.example/cpp', 'https://school.example/wp-admin/', 'https://school.example/%6cogin/', 'https://school.example/cpp/?token=private', 'https://u:p@school.example/cpp/', 'https://school.example:8080/cpp/', 'file:///cpp']) {
  assert.equal(censusSiteUrl(url, source.url), null, url);
}
assert.equal(censusSiteUrl('https://school.example/cpp/#form', source.url), source.url);
assert.equal(censusSiteUrl('https://neja74.wixsite.com/other/cpp', 'https://neja74.wixsite.com/website/'), null);
assert.deepEqual(resumeCensusFrontier({school_id: 1, source_url: source.url, pending_pages: [{url: source.url, discovered_on: 'https://other.example/'}]}, source), []);
assert.equal(saveCensusFrontier(queue.concat(Array.from({length: 110}, (_, i) => ({url: `${source.url}${i}`, discovered_on: source.url}))), source).length, 100);
console.log('CPP census continuation PASS: eventual coverage, weekly budget, provenance, identity, boundary and stop gates.');
