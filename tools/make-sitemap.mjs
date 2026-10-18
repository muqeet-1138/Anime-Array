#!/usr/bin/env node
/**
 * tools/make-sitemap.mjs
 *
 * Generates a Google-compatible sitemap at docs/sitemap.xml.
 *
 * Run:
 *   node tools/make-sitemap.mjs
 *
 * Optional custom origin:
 *   node tools/make-sitemap.mjs https://muqeet-1138.github.io/Anime-Array/
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

const DOCS = path.join(ROOT, 'docs');

const DEFAULT_ORIGIN =
  'https://muqeet-1138.github.io/Anime-Array/';

const rawOrigin = process.argv[2] || DEFAULT_ORIGIN;
const originUrl = new URL(rawOrigin);

if (originUrl.protocol !== 'https:' || originUrl.search || originUrl.hash) {
  throw new Error('Origin must be an HTTPS URL without a query or fragment.');
}

const ORIGIN = originUrl.href.replace(/\/+$/, '');
const BASE_PATH = originUrl.pathname.replace(/\/+$/, '') || '';

const SITEMAP_FILE = path.join(DOCS, 'sitemap.xml');
const MAX_URLS = 50_000;
const MAX_BYTES = 50 * 1024 * 1024;

const excluded = [];
const candidates = [];

// Escape XML values so generated XML remains well-formed.
function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Decode common HTML entities in HTML attribute values.
function decodeEntities(value) {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCodePoint(parseInt(n, 16))
    )
    .replace(/&#([0-9]+);/g, (_, n) =>
      String.fromCodePoint(parseInt(n, 10))
    );
}

function isStub(file) {
  return /^google[0-9a-f]+\.html$/i.test(file) ||
    /verification/i.test(file);
}

function isNoindex(html) {
  // Handles name/content attributes in either order.
  const tags = html.match(/<meta\b[^>]*>/gi) || [];

  return tags.some((tag) => {
    const name = tag.match(/\bname\s*=\s*["']([^"']+)["']/i)?.[1];
    const content = tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1];

    return name?.toLowerCase() === 'robots' &&
      /(?:^|[\s,])noindex(?:$|[\s,])/i.test(content || '');
  });
}

function canonicalOf(html) {
  const links = html.match(/<link\b[^>]*>/gi) || [];

  for (const tag of links) {
    const rel = tag.match(/\brel\s*=\s*["']([^"']+)["']/i)?.[1];
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];

    if (
      rel?.toLowerCase().split(/\s+/).includes('canonical') &&
      href
    ) {
      return decodeEntities(href.trim());
    }
  }

  return null;
}

function normalizeCanonical(raw, file) {
  let url;

  try {
    url = new URL(raw, ORIGIN + '/');
  } catch {
    excluded.push(`${file} (invalid canonical URL)`);
    return null;
  }

  if (url.protocol !== 'https:') {
    excluded.push(`${file} (canonical must use HTTPS)`);
    return null;
  }

  if (url.origin !== originUrl.origin) {
    excluded.push(`${file} (canonical points to another origin)`);
    return null;
  }

  if (url.username || url.password || url.search || url.hash) {
    excluded.push(`${file} (canonical contains credentials, query or fragment)`);
    return null;
  }

  if (BASE_PATH && url.pathname !== BASE_PATH &&
      !url.pathname.startsWith(BASE_PATH + '/')) {
    excluded.push(`${file} (canonical is outside the GitHub Pages project path)`);
    return null;
  }

  // Reject URLs containing whitespace or malformed percent escapes.
  if (/\s/.test(url.href) || /%(?![0-9a-f]{2})/i.test(url.href)) {
    excluded.push(`${file} (malformed canonical URL)`);
    return null;
  }

  return url.href;
}

function walk(directory, relative = '') {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    const relPath = path.posix.join(relative, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== '.git' && entry.name !== 'node_modules') {
        walk(fullPath, relPath);
      }
      continue;
    }

    if (!entry.isFile() || !/\.html?$/i.test(entry.name)) {
      continue;
    }

    if (isStub(entry.name) || entry.name.toLowerCase() === '404.html') {
      excluded.push(`${relPath} (verification stub or 404 page)`);
      continue;
    }

    candidates.push({ file: relPath, fullPath });
  }
}

if (!fs.existsSync(DOCS)) {
  throw new Error(`Docs directory not found: ${DOCS}`);
}

walk(DOCS);

const seen = new Set();
const included = [];

for (const { file, fullPath } of candidates) {
  const html = fs.readFileSync(fullPath, 'utf8');

  if (isNoindex(html)) {
    excluded.push(`${file} (noindex)`);
    continue;
  }

  const rawCanonical = canonicalOf(html);

  if (!rawCanonical) {
    excluded.push(`${file} (missing canonical link)`);
    continue;
  }

  const url = normalizeCanonical(rawCanonical, file);

  if (!url) continue;

  if (seen.has(url)) {
    excluded.push(`${file} (duplicate canonical URL: ${url})`);
    continue;
  }

  seen.add(url);

  included.push({
    file,
    url,
    // File timestamps are only a proxy for significant content updates.
    lastmod: new Date(fs.statSync(fullPath).mtime)
      .toISOString()
      .replace(/\.\d{3}Z$/, 'Z'),
  });
}

// Put the project homepage first, followed by stable alphabetical order.
const homeUrl = ORIGIN + '/';

included.sort((a, b) => {
  if (a.url === homeUrl) return -1;
  if (b.url === homeUrl) return 1;
  return a.url.localeCompare(b.url);
});

if (included.length > MAX_URLS) {
  throw new Error(
    `Found ${included.length} URLs; a sitemap supports at most ${MAX_URLS}. ` +
    'Generate a sitemap index and split the URLs into multiple sitemap files.'
  );
}

const lines = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
];

for (const entry of included) {
  lines.push('  <url>');
  lines.push(`    <loc>${xmlEscape(entry.url)}</loc>`);
  lines.push(`    <lastmod>${entry.lastmod}</lastmod>`);
  lines.push('  </url>');
}

lines.push('</urlset>', '');

const output = lines.join('\n');
const bytes = Buffer.byteLength(output, 'utf8');

if (bytes > MAX_BYTES) {
  throw new Error('Sitemap exceeds the 50 MB uncompressed size limit.');
}

fs.writeFileSync(SITEMAP_FILE, output, 'utf8');

console.log(`Sitemap written: ${SITEMAP_FILE}`);
console.log(`Included: ${included.length} URL(s)`);

for (const entry of included) {
  console.log(`  ${entry.lastmod}  ${entry.url}`);
}

if (excluded.length) {
  console.log(`\nExcluded: ${excluded.length}`);

  for (const item of excluded) {
    console.log(`  ${item}`);
  }
}
