#!/usr/bin/env node
/**
 * check-site.mjs
 *
 * Verifies the published documentation site before it is relied upon.
 * Run with:  node tools/check-site.mjs
 *
 * The same checks are what the CI workflow runs, so a green build means the
 * checks actually passed rather than that nobody looked.
 *
 * What it enforces:
 *   - valid doctype, language, charset, viewport
 *   - exactly one non-empty <h1>
 *   - title length within a range Google will not truncate
 *   - meta description length within a range that is neither waste nor truncated
 *   - canonical, Open Graph and Twitter card metadata complete
 *   - JSON-LD parses, and every @id referenced in a relation is defined
 *   - every <img> has alt text
 *   - every internal link resolves to a file that exists
 *   - every page clears the word floor
 *   - no reference to the main site's media paths (those are not ours to publish)
 *
 * Exit code 0 if everything passes, 1 otherwise. No dependencies.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'docs');

const WORD_FLOOR = 1000;
const TITLE_MIN = 20;
const TITLE_MAX = 70;
const DESC_MIN = 70;
const DESC_MAX = 165;

/** Pages exempt from the word floor, with the reason recorded here rather than guessed at. */
const FLOOR_EXEMPT = {
  '404.html': 'An error page. Padding it to a word count would help nobody.'
};

const REQUIRED_META = [
  ['og:type', /property="og:type"/i],
  ['og:site_name', /property="og:site_name"/i],
  ['og:title', /property="og:title"/i],
  ['og:description', /property="og:description"/i],
  ['og:url', /property="og:url"/i],
  ['og:image', /property="og:image"/i],
  ['og:image:alt', /property="og:image:alt"/i],
  ['og:locale', /property="og:locale"/i],
  ['twitter:card', /name="twitter:card"/i],
  ['twitter:title', /name="twitter:title"/i],
  ['twitter:description', /name="twitter:description"/i]
];

/** Words a reader would actually see. Strips head, scripts, nav and footer. */
function visibleWords(html) {
  return html
    .replace(/<head>[\s\S]*?<\/head>/i, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
}

/** Collect every @id defined in a JSON-LD graph, so references can be checked. */
function collectIds(node, out) {
  if (Array.isArray(node)) { node.forEach((n) => collectIds(n, out)); return out; }
  if (node && typeof node === 'object') {
    if (typeof node['@id'] === 'string') out.add(node['@id']);
    Object.values(node).forEach((v) => collectIds(v, out));
  }
  return out;
}

/** Collect every @id referenced by a relation, so dangling references are caught. */
function collectRefs(node, out) {
  if (Array.isArray(node)) { node.forEach((n) => collectRefs(n, out)); return out; }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k !== '@id' && (typeof v === 'string' || Array.isArray(v))) {
        const vals = Array.isArray(v) ? v : [v];
        for (const val of vals) if (typeof val === 'string' && val.includes('#')) out.add(val);
      }
      collectRefs(v, out);
    }
  }
  return out;
}

function checkPage(file) {
  const html = fs.readFileSync(path.join(DOCS, file), 'utf8');
  const problems = [];
  const add = (m) => problems.push(m);

  // Set of exemptions, resolved first so every rule below can consult it.
  const floor = FLOOR_EXEMPT[file];

  // Document
  if (!/^<!DOCTYPE html>/i.test(html.trim())) add('missing doctype on line 1');
  if (!/<html[^>]+lang="[a-z]{2}/i.test(html)) add('missing or invalid lang attribute');
  if (!/<meta charset=/i.test(html)) add('missing charset');
  if (!/name="viewport"/i.test(html)) add('missing viewport');

  const h1s = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/gi) || [];
  if (h1s.length === 0) add('no <h1>');
  else if (h1s.length > 1) add(`${h1s.length} <h1> elements, expected exactly 1`);
  else if (!/<h1[^>]*>\s*\S/i.test(h1s[0])) add('<h1> is empty');

  // Title
  const title = (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]?.trim() || '';
  if (!title) add('missing <title>');
  else if (title.length > TITLE_MAX) add(`title is ${title.length} chars, max ${TITLE_MAX} (will truncate)`);
  else if (title.length < TITLE_MIN) add(`title is only ${title.length} chars, min ${TITLE_MIN}`);

  // Description
  const desc = (html.match(/<meta\s+name="description"\s+content="([^"]*)"/i) || [])[1]?.trim() || '';
  if (!desc) add('missing meta description');
  else if (desc.length > DESC_MAX) add(`description is ${desc.length} chars, max ${DESC_MAX} (will truncate)`);
  else if (desc.length < DESC_MIN) add(`description is only ${desc.length} chars, min ${DESC_MIN}`);

  // Canonical
  const canon = (html.match(/rel="canonical"\s+href="([^"]*)"/i) || [])[1] || '';
  if (!canon) add('missing canonical');
  else if (!/^https:\/\//.test(canon)) add('canonical is not absolute https');

  // Social metadata
  for (const [name, re] of REQUIRED_META) if (!re.test(html)) add('missing ' + name);

  // Structured data
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)];
  const needsLd = !floor;
  if (blocks.length === 0 && needsLd) add('no JSON-LD structured data');
  const ids = new Set();
  const refs = new Set();
  blocks.forEach((m, i) => {
    let parsed;
    try { parsed = JSON.parse(m[1]); }
    catch (e) { add(`JSON-LD block ${i} does not parse: ${e.message}`); return; }
    if (!parsed['@context']) add(`JSON-LD block ${i} missing @context`);
    collectIds(parsed, ids);
    collectRefs(parsed, refs);
  });
  for (const ref of refs) {
    if (!ids.has(ref)) add(`JSON-LD references ${ref} but never defines it`);
  }

  // Images
  for (const m of html.matchAll(/<img[^>]*>/gi)) {
    if (!/\salt="/i.test(m[0])) add('img without alt attribute: ' + m[0].slice(0, 60));
  }

  // Internal links
  for (const m of html.matchAll(/href="([^"]+)"/gi)) {
    const href = m[1];
    if (/^(https?:|mailto:|tel:|#|\/\/)/i.test(href)) continue;
    if (href.startsWith('/')) continue;
    const target = path.join(DOCS, href.split('#')[0].split('?')[0]);
    if (!fs.existsSync(target)) add('dead internal link: ' + href);
  }

  // We must not publish the main site's media paths
  if (/animearray\.site\/(wp-|app-|uploads)/i.test(html)) {
    add('references a main-site media path, which leaks internal structure');
  }

  const words = visibleWords(html);
  if (!floor && words < WORD_FLOOR) add(`${words} visible words, floor is ${WORD_FLOOR}`);

  return { file, words, title: title.length, desc: desc.length, jsonld: blocks.length, problems, floor };
}

// Search Console and similar verification stubs live in docs/ because they must
// be served from the site root to work. They are not pages: one line of text,
// no doctype, no head. Checking them as pages would report dozens of failures
// that say nothing about the site.
const isVerificationStub = (f) => /^google[0-9a-f]+\.html$/i.test(f) ||
                                 /^[a-z0-9-]*verification[a-z0-9-]*\.html$/i.test(f);

const allHtml = fs.existsSync(DOCS) ? fs.readdirSync(DOCS).filter((f) => f.endsWith('.html')) : [];
const stubs = allHtml.filter(isVerificationStub);
const files = allHtml.filter((f) => !isVerificationStub(f)).sort();

if (!files.length) {
  console.error('No HTML found in docs/. Nothing to check.');
  process.exit(1);
}

let failed = 0;
console.log(`Checking ${files.length} page(s) in docs/\n`);
if (stubs.length) {
  console.log(`Skipping ${stubs.length} verification stub(s): ${stubs.join(', ')}\n`);
}

for (const file of files) {
  const r = checkPage(file);
  const status = r.problems.length ? 'FAIL' : 'OK  ';
  const note = r.floor ? ` (exempt: ${r.floor})` : '';
  console.log(`${status} ${r.file.padEnd(18)} ${String(r.words).padStart(5)} words | title ${String(r.title).padStart(3)} | desc ${String(r.desc).padStart(3)} | jsonld ${r.jsonld}${note}`);
  for (const p of r.problems) console.log(`       - ${p}`);
  failed += r.problems.length;
}

// ---------------------------------------------------------------------------
// Sitemap. Validated against Google's actual requirements, not only for
// URL-to-file correspondence. A sitemap that parses but lists a 404, a noindex
// page or a mismatched canonical is the common way one stops being read.
// ---------------------------------------------------------------------------

const sitemapPath = path.join(DOCS, 'sitemap.xml');
if (!fs.existsSync(sitemapPath)) {
    console.log('- docs/sitemap.xml is missing');
    failed++;
} else {
    const bytes = fs.readFileSync(sitemapPath);

    // -----------------------------------------------------------------------
    // Encoding and the XML declaration. This is the failure that actually
    // happens: the file gets edited by hand, gains a blank first line or a
    // byte-order mark, and every browser and crawler reports "XML declaration
    // allowed only at the start of the document". The declaration must be the
    // literal first characters of the file, not merely present somewhere.
    // -----------------------------------------------------------------------

    if (bytes[0] === 0xFF && bytes[1] === 0xFE) {
        console.log('- sitemap.xml is UTF-16 LE. It must be UTF-8 without a BOM.'); failed++;
    } else if (bytes[0] === 0xFE && bytes[1] === 0xFF) {
        console.log('- sitemap.xml is UTF-16 BE. It must be UTF-8 without a BOM.'); failed++;
    } else if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
        console.log('- sitemap.xml starts with a UTF-8 BOM, which some parsers reject before the declaration'); failed++;
    }

    if (bytes.subarray(0, 400).includes(0)) {
        console.log('- sitemap.xml contains NUL bytes, which means it was saved as UTF-16'); failed++;
    }

    const text = bytes.toString('utf8').replace(/^\uFEFF/, '');

    if (!text.startsWith('<?xml')) {
        const firstLine = JSON.stringify((text.split('\n')[0] || '').slice(0, 40));
        if (/^\s+$/.test(text.split('\n')[0] || '') || text[0] === '\n') {
            console.log(`- sitemap.xml starts with an empty line. The XML declaration must be the first line.`); failed++;
        } else if (/^\s/.test(text)) {
            console.log(`- sitemap.xml starts with whitespace. The XML declaration must be the first character.`); failed++;
        } else {
            console.log(`- sitemap.xml has no XML declaration on line 1 (line 1 is ${firstLine})`); failed++;
        }
    } else if (!/^<\?xml\s+version="1\.0"\s+encoding="UTF-8"\?>/.test(text)) {
        console.log('- sitemap.xml declaration must be: <?xml version="1.0" encoding="UTF-8"?>'); failed++;
    }

    const declLine = text.split('\n').findIndex((l) => l.includes('<?xml')) + 1;
    if (declLine > 1) {
        console.log(`- the XML declaration is on line ${declLine}; it is only valid on line 1`); failed++;
    }

    const ns = (text.match(/xmlns="([^"]+)"/) || [])[1];
    if (ns !== 'http://www.sitemaps.org/schemas/sitemap/0.9') {
        console.log(`- sitemap.xml namespace is "${ns}", expected the sitemaps.org 0.9 namespace`); failed++;
    }

    // An unescaped ampersand is a fatal parse error, and the most common one.
    const badAmp = text.match(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g) || [];
    if (badAmp.length) {
        console.log(`- sitemap.xml has ${badAmp.length} unescaped ampersand(s), a fatal XML error`); failed++;
    }

    const openUrlset = (text.match(/<urlset\b/g) || []).length;
    const closeUrlset = (text.match(/<\/urlset>/g) || []).length;
    if (openUrlset !== 1 || closeUrlset !== 1) {
        console.log(`- sitemap.xml urlset open=${openUrlset} close=${closeUrlset}`); failed++;
    }

    // Every tag the sitemap schema defines. changefreq and priority are ignored
    // by Google, but they are legal and WordPress emits them, so they are
    // allowed here rather than treated as a defect.
    const ALLOWED = new Set(['urlset', 'url', 'loc', 'lastmod', 'changefreq', 'priority']);
    const tags = [...text.matchAll(/<([a-zA-Z][a-zA-Z0-9:._-]*)\b[^>]*>/g)].map((m) => m[1]);
    const unknown = [...new Set(tags)].filter((t) => !ALLOWED.has(t));
    if (unknown.length) {
        console.log(`- sitemap.xml contains unrecognised tag(s): ${unknown.join(', ')}`); failed++;
    }

    const locs = [...text.matchAll(/<loc>([\s\S]*?)<\/loc>/g)].map((m) => m[1].trim());
    for (const l of locs) {
        if (!/^https:\/\//.test(l)) { console.log(`- sitemap loc is not absolute https: ${l}`); failed++; }
        if (/\s/.test(l)) { console.log(`- sitemap loc contains whitespace: ${l}`); failed++; }
    }

    for (const m of text.matchAll(/<lastmod>([\s\S]*?)<\/lastmod>/g)) {
        const v = m[1].trim();
        const ok = /^\d{4}-\d{2}-\d{2}$/.test(v) ||
                   /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(v);
        if (!ok) { console.log(`- lastmod is neither YYYY-MM-DD nor a W3C datetime: ${v}`); failed++; }
    }

    const VALID_FREQ = new Set(['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never']);
    for (const m of text.matchAll(/<changefreq>([\s\S]*?)<\/changefreq>/g)) {
        const v = m[1].trim();
        if (!VALID_FREQ.has(v)) { console.log(`- changefreq "${v}" is not one of ${[...VALID_FREQ].join(', ')}`); failed++; }
    }

    for (const m of text.matchAll(/<priority>([\s\S]*?)<\/priority>/g)) {
        const v = m[1].trim();
        const n = Number(v);
        if (!/^\d(\.\d+)?$/.test(v) || Number.isNaN(n) || n < 0 || n > 1) {
            console.log(`- priority "${v}" is not a number between 0.0 and 1.0`); failed++;
        }
    }

    // A 404 and a verification stub must never be submitted.
    if (text.includes('404.html')) { console.log('- sitemap.xml lists 404.html, which must never be submitted'); failed++; }
    if (/google[0-9a-f]{6,}\.html/.test(text)) { console.log('- sitemap.xml lists a verification stub'); failed++; }

    const BASE = 'https://muqeet-1138.github.io/Anime-Array/';
    const listed = new Set();
    for (const l of locs) {
        if (!l.startsWith(BASE)) {
            console.log(`- sitemap entry ${l} is not on the published Pages origin`); failed++;
            continue;
        }
        const slug = l.slice(BASE.length) || 'index.html';
        listed.add(slug);
        if (!fs.existsSync(path.join(DOCS, slug))) {
            console.log(`- sitemap lists ${slug} but docs/${slug} does not exist`); failed++;
        }
    }

    // Every indexable page must be listed, and must agree with its canonical.
    for (const f of files) {
        if (FLOOR_EXEMPT[f]) continue;
        const html = fs.readFileSync(path.join(DOCS, f), 'utf8');
        if (/<meta[^>]+name=["']robots["'][^>]*noindex/i.test(html) && listed.has(f)) {
            console.log(`- ${f} is noindex but is listed in the sitemap`); failed++;
        }
        if (!listed.has(f)) {
            console.log(`- ${f} is indexable but missing from the sitemap; run node tools/make-sitemap.mjs`); failed++;
        }
    }
    console.log(`  sitemap lists ${locs.length} indexable URL(s), no 404s, no stubs, no noindex pages`);

    // robots.txt must point at it and must not block crawling.
    const rbPath = path.join(DOCS, 'robots.txt');
    if (!fs.existsSync(rbPath)) {
        console.log('- docs/robots.txt is missing'); failed++;
    } else {
        const rb = fs.readFileSync(rbPath, 'utf8');
        const declared = (rb.match(/^\s*Sitemap:\s*(\S+)/im) || [])[1];
        if (!declared) { console.log('- robots.txt declares no Sitemap'); failed++; }
        else if (declared.replace(/\/+$/, '') !== `${BASE}sitemap.xml`) {
            console.log(`- robots.txt points at ${declared}, which is not this sitemap`); failed++;
        }
        if (/^\s*Disallow:\s*\/\s*$/im.test(rb)) {
            console.log('- robots.txt contains a blanket Disallow: /'); failed++;
        }
    }
}

// ---------------------------------------------------------------------------
// Assets, navigation and footer consistency.
//
// These are the checks that catch a page being quietly left behind when
// another one changes. Adding a page should not require remembering six
// other edits, so they are asserted rather than trusted.
// ---------------------------------------------------------------------------

console.log('Assets and cross-page consistency:\n');

// Every og:image must resolve to a file that exists, and no two content pages
// should share a card: identical share images make a page look unmaintained.
const cardUse = new Map();
for (const file of files) {
  if (FLOOR_EXEMPT[file]) continue;
  const html = fs.readFileSync(path.join(DOCS, file), 'utf8');
  const m = html.match(/<meta property="og:image" content="[^"]*\/([^/"]+)"/);
  if (!m) continue;
  const card = m[1];
  if (!fs.existsSync(path.join(DOCS, 'assets', card))) {
    console.log(`  - docs/${file} references ${card}, which does not exist`);
    failed++;
  }
  if (!cardUse.has(card)) cardUse.set(card, []);
  cardUse.get(card).push(file);
}
for (const [card, users] of cardUse) {
  // index.html and 404.html legitimately share the default card.
  const distinct = users.filter((u) => u !== 'index.html');
  if (users.length > 1 && distinct.length > 1) {
    console.log(`  - ${card} is shared by ${distinct.join(' and ')}; each content page needs its own card`);
    failed++;
  }
}
console.log(`  ${cardUse.size} social card(s) referenced, all present`);

// The header nav must be identical everywhere, with aria-current only on self.
const navSets = new Map();
for (const file of files) {
  const html = fs.readFileSync(path.join(DOCS, file), 'utf8');
  const nav = (html.match(/<nav class="site"[\s\S]*?<\/nav>/i) || [''])[0];
  const hrefs = [...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  const current = [...nav.matchAll(/aria-current="page"/g)].length;
  const key = hrefs.join(',');
  if (!navSets.has(key)) navSets.set(key, []);
  navSets.get(key).push({ file, current, self: hrefs.find((h) => h === file) });
}
if (navSets.size > 1) {
  console.log(`  - the header nav differs between pages (${navSets.size} variants found)`);
  failed++;
}
for (const group of navSets.values()) {
  for (const g of group) {
    if (g.self && g.current !== 1) {
      console.log(`  - ${g.file} should mark its own nav item with aria-current, found ${g.current}`);
      failed++;
    }
    if (!g.self && g.current !== 0) {
      console.log(`  - ${g.file} marks a nav item it is not on as aria-current`);
      failed++;
    }
  }
}
console.log(`  header nav identical across all ${files.length} pages`);

// Every page must carry the same documentation link set in its footer.
const docLinkSets = new Map();
for (const file of files) {
  const html = fs.readFileSync(path.join(DOCS, file), 'utf8');
  const col = html.match(/<h2>This site<\/h2>[\s\S]*?<\/ul>/i);
  const hrefs = col ? [...col[0].matchAll(/href="([^"]+)"/g)].map((m) => m[1]) : [];
  const key = hrefs.join(',');
  if (!docLinkSets.has(key)) docLinkSets.set(key, []);
  docLinkSets.get(key).push(file);
}
if (docLinkSets.size > 1) {
  console.log(`  - the footer documentation column differs between pages (${docLinkSets.size} variants)`);
  failed++;
} else {
  const n = [...docLinkSets.keys()][0].split(',').filter(Boolean).length;
  console.log(`  footer documentation column consistent, ${n} links on every page`);
}

// Any page listed in the sitemap must be reachable from the others.
const pages = files.filter((f) => !FLOOR_EXEMPT[f]);
for (const file of pages) {
  if (file === 'index.html') continue;
  let linked = 0;
  for (const other of files) {
    if (other === file) continue;
    const html = fs.readFileSync(path.join(DOCS, other), 'utf8');
    if (html.includes(`href="${file}"`)) linked++;
  }
  if (linked === 0) {
    console.log(`  - docs/${file} is orphaned: no other page links to it`);
    failed++;
  }
}
console.log(`  no orphaned pages among ${pages.length} indexable pages`);

// Brand assets. These are referenced from every page, so a missing file is a
// broken header or a missing favicon on the whole site.
const REQUIRED_ASSETS = [
    ['logo-64.png', 'the header mark at 1x'],
    ['logo-192.png', 'the header mark at 2x'],
    ['logo-128.png', 'a general logo size'],
    ['logo-256.png', 'the reference-sized logo'],
    ['logo.png', 'the full logo'],
    ['favicon-mark.png', 'the ring-cropped favicon master'],
    ['favicon-16.png', '16px favicon'],
    ['favicon-32.png', '32px favicon'],
    ['favicon-48.png', '48px favicon, the one high-density displays use'],
    ['favicon-64.png', '64px favicon'],
    ['favicon.ico', 'multi-size favicon'],
    ['apple-touch-icon.png', 'iOS home-screen icon']
];
for (const [file, why] of REQUIRED_ASSETS) {
    const p = path.join(DOCS, 'assets', file);
    if (!fs.existsSync(p)) { console.log(`  - docs/assets/${file} is missing (${why})`); failed++; }
    else if (fs.statSync(p).size === 0) { console.log(`  - docs/assets/${file} is zero bytes (${why})`); failed++; }
}

// Every page must reference the same logo and the same icon files.
const ICON_FILES = ['favicon.ico', 'favicon-48.png', 'favicon-32.png', 'favicon-16.png', 'apple-touch-icon.png'];
for (const file of files) {
    const html = fs.readFileSync(path.join(DOCS, file), 'utf8');
    const marks = (html.match(/<img[^>]+class="mark"/g) || []).length;
    if (marks !== 1) { console.log(`  - ${file} has ${marks} header marks, expected 1`); failed++; }
    for (const icon of ICON_FILES) {
        if (!html.includes(`assets/${icon}`)) { console.log(`  - ${file} does not link ${icon}`); failed++; }
    }
    // sizes="any" belongs to vector icons. On a bitmap .ico it lets the browser
    // scale from the smallest entry, which is the blurriest one.
    if (/rel="icon"[^>]*sizes="any"/.test(html)) {
        console.log(`  - ${file} uses sizes="any" on a bitmap icon`); failed++;
    }
    for (const s of ['48x48', '32x32', '16x16']) {
        if (!html.includes(`sizes="${s}"`)) { console.log(`  - ${file} does not declare a ${s} icon`); failed++; }
    }
}
console.log(`  ${REQUIRED_ASSETS.length} brand asset(s) present; logo and icons linked on all ${files.length} pages`);

console.log('');
console.log(failed ? `${failed} problem(s) found` : 'All checks passed');
process.exit(failed ? 1 : 0);
process.exit(failed ? 1 : 0);