#!/usr/bin/env node
/**
 * make-sitemap.mjs
 *
 * Writes docs/sitemap.xml in the same shape a WordPress SEO plugin produces:
 * loc, lastmod, changefreq and priority, one <url> per page.
 *
 * Encoding matters more than anything else here. The file is written as plain
 * UTF-8 with no byte-order mark, and the XML declaration is the very first
 * character. A blank line, a space, or a BOM in front of "<?xml" makes a strict
 * parser reject the whole file with "XML declaration allowed only at the start
 * of the document", which is what happened when the file was edited by hand.
 *
 * lastmod values come from git, not from file timestamps, so regenerating on a
 * different machine does not rewrite every date and produce a noisy diff.
 *
 * Run:  node tools/make-sitemap.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'docs');
const BASE = 'https://muqeet-1138.github.io/Anime-Array/';

// A verification stub is not a page. Neither is the 404.
const isStub = (f) => /^google[0-9a-f]+\.html$/i.test(f) || /verification/i.test(f);

/**
 * Per-page crawl hints. Google states it ignores changefreq and priority, so
 * these exist to keep the file shaped like a WordPress sitemap, not to influence
 * ranking. They are still set honestly: the home page does change most often,
 * and a policy page does not change weekly.
 */
const HINTS = {
    'index.html':      { changefreq: 'daily',   priority: '1.0' },
    'about.html':      { changefreq: 'monthly', priority: '0.6' },
    'characters.html': { changefreq: 'weekly',  priority: '0.9' },
    'products.html':   { changefreq: 'weekly',  priority: '0.8' },
    'technology.html': { changefreq: 'weekly',  priority: '0.8' },
    'faq.html':        { changefreq: 'monthly', priority: '0.7' },
    'policies.html':   { changefreq: 'monthly', priority: '0.5' }
};

const DEFAULT_HINT = { changefreq: 'monthly', priority: '0.5' };

/** 2026-10-17T21:03:25+00:00 - UTC, the same shape WordPress emits. */
function toUtc(ms) {
    return new Date(ms).toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

function gitLastCommitDate(file) {
    try {
        const seconds = execFileSync(
            'git',
            ['log', '-1', '--format=%ct', '--', path.posix.join('docs', file)],
            { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
        ).trim();
        if (/^\d+$/.test(seconds)) return toUtc(Number(seconds) * 1000);
    } catch {
        /* no git, or a shallow clone without history for this file */
    }
    // Fall back to the file's own timestamp, normalised to the same shape.
    return toUtc(fs.statSync(path.join(DOCS, file)).mtimeMs);
}

function canonicalOf(file) {
    const html = fs.readFileSync(path.join(DOCS, file), 'utf8');
    return (html.match(/rel=["']canonical["'][^>]*href=["']([^"']+)/i) || [])[1] || null;
}

function isNoindex(file) {
    const html = fs.readFileSync(path.join(DOCS, file), 'utf8');
    return /<meta[^>]+name=["']robots["'][^>]*noindex/i.test(html);
}

const candidates = fs
    .readdirSync(DOCS)
    .filter((f) => f.endsWith('.html') && !isStub(f))
    .sort();

const included = [];
const excluded = [];

for (const file of candidates) {
    if (file === '404.html') {
        excluded.push(`${file} (a URL that returns 404 must never be submitted)`);
        continue;
    }
    if (isNoindex(file)) {
        excluded.push(`${file} (noindex)`);
        continue;
    }
    const canonical = canonicalOf(file);
    if (!canonical) {
        excluded.push(`${file} (no canonical link, so its URL is ambiguous)`);
        continue;
    }
    included.push({ file, loc: canonical, lastmod: gitLastCommitDate(file) });
}

// Home page first, then alphabetical: stable and diff-friendly.
included.sort((a, b) =>
    a.file === 'index.html' ? -1 : b.file === 'index.html' ? 1 : a.file.localeCompare(b.file)
);

const out = [];
out.push('<?xml version="1.0" encoding="UTF-8"?>');
out.push('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');

for (const entry of included) {
    const hint = HINTS[entry.file] || DEFAULT_HINT;
    out.push('  <url>');
    out.push(`    <loc>${entry.loc}</loc>`);
    out.push(`    <lastmod>${entry.lastmod}</lastmod>`);
    out.push(`    <changefreq>${hint.changefreq}</changefreq>`);
    out.push(`    <priority>${hint.priority}</priority>`);
    out.push('  </url>');
}

out.push('</urlset>');
out.push('');

// utf8 without a BOM, and the declaration is the first byte of the file.
fs.writeFileSync(path.join(DOCS, 'sitemap.xml'), out.join('\n'), 'utf8');

const written = fs.readFileSync(path.join(DOCS, 'sitemap.xml'));
console.log(`docs/sitemap.xml written: ${included.length} URL(s), ${written.length} bytes`);
console.log(`first bytes: ${[...written.slice(0, 4)].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')}  (3C 3F 78 6D = "<?xm")`);
console.log('');
included.forEach((e) => {
    const hint = HINTS[e.file] || DEFAULT_HINT;
    console.log(`  ${e.lastmod}  ${hint.priority.padEnd(4)} ${hint.changefreq.padEnd(8)} ${e.loc}`);
});
if (excluded.length) {
    console.log('\nexcluded:');
    excluded.forEach((x) => console.log(`  ${x}`));
}
