
#!/usr/bin/env node

/**
 * make-sitemap.mjs
 *
 * Generates a Google-compatible XML sitemap for GitHub Pages.
 *
 * Output:
 *   docs/sitemap.xml
 *
 * Run:
 *   node tools/make-sitemap.mjs
 *
 * Optional custom site URL:
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
const OUTPUT = path.join(DOCS, 'sitemap.xml');

const DEFAULT_ORIGIN =
  'https://muqeet-1138.github.io/Anime-Array/';

const MAX_URLS = 50000;
const MAX_BYTES = 50 * 1024 * 1024;

const excluded = [];
const included = [];
const seenUrls = new Set();

function log(message) {
  console.log(`[sitemap] ${message}`);
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#([0-9]+);/g, (_, dec) =>
      String.fromCodePoint(parseInt(dec, 10))
    );
}

function getAttribute(tag, attribute) {
  const pattern = new RegExp(
    `(?:^|\\s)${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    'i'
  );

  const match = tag.match(pattern);

  return match
    ? (match[1] ?? match[2] ?? match[3] ?? '')
    : null;
}

function isVerificationFile(filename) {
  return (
    /^google[0-9a-f]+\.html$/i.test(filename) ||
    /verification/i.test(filename)
  );
}

function hasNoindex(html) {
  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];

  return metaTags.some((tag) => {
    const name = getAttribute(tag, 'name');
    const content = getAttribute(tag, 'content');

    return (
      name?.toLowerCase() === 'robots' &&
      /(?:^|[\s,])noindex(?:$|[\s,])/i.test(content || '')
    );
  });
}

function getCanonical(html) {
  const linkTags = html.match(/<link\b[^>]*>/gi) || [];

  for (const tag of linkTags) {
    const rel = getAttribute(tag, 'rel');
    const href = getAttribute(tag, 'href');

    if (
      rel &&
      rel.toLowerCase().split(/\s+/).includes('canonical') &&
      href
    ) {
      return decodeHtmlEntities(href.trim());
    }
  }

  return null;
}

function collectHtmlFiles(directory, relative = '') {
  const entries = fs.readdirSync(directory, {
    withFileTypes: true,
  });

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.posix.join(relative, entry.name);

    if (entry.isDirectory()) {
      if (
        entry.name !== '.git' &&
        entry.name !== 'node_modules'
      ) {
        collectHtmlFiles(absolutePath, relativePath);
      }

      continue;
    }

    if (!entry.isFile() || !/\.html?$/i.test(entry.name)) {
      continue;
    }

    if (
      entry.name.toLowerCase() === '404.html' ||
      isVerificationFile(entry.name)
    ) {
      excluded.push(`${relativePath}: excluded page`);
      continue;
    }

    processHtmlFile(absolutePath, relativePath);
  }
}

function processHtmlFile(absolutePath, relativePath) {
  const html = fs.readFileSync(absolutePath, 'utf8');

  if (hasNoindex(html)) {
    excluded.push(`${relativePath}: noindex`);
    return;
  }

  const canonical = getCanonical(html);

  if (!canonical) {
    excluded.push(`${relativePath}: missing canonical link`);
    return;
  }

  let url;

  try {
    url = new URL(canonical);
  } catch {
    excluded.push(`${relativePath}: invalid canonical URL`);
    return;
  }

  if (url.protocol !== 'https:') {
    excluded.push(`${relativePath}: canonical must use HTTPS`);
    return;
  }

  if (url.origin !== SITE.origin) {
    excluded.push(`${relativePath}: canonical uses another origin`);
    return;
  }

  if (url.username || url.password || url.search || url.hash) {
    excluded.push(`${relativePath}: invalid canonical URL components`);
    return;
  }

  // GitHub Pages project sites must retain their repository path.
  if (
    SITE_BASE_PATH &&
    url.pathname !== SITE_BASE_PATH &&
    !url.pathname.startsWith(SITE_BASE_PATH + '/')
  ) {
    excluded.push(`${relativePath}: URL is outside the project path`);
    return;
  }

  if (/\s/.test(url.href)) {
    excluded.push(`${relativePath}: URL contains whitespace`);
    return;
  }

  if (seenUrls.has(url.href)) {
    excluded.push(`${relativePath}: duplicate canonical URL`);
    return;
  }

  seenUrls.add(url.href);

  const stat = fs.statSync(absolutePath);

  included.push({
    file: relativePath,
    url: url.href,
    lastmod: stat.mtime.toISOString().replace(/\.\d{3}Z$/, 'Z'),
  });
}

// Resolve and validate the configured site URL.
const rawOrigin = process.argv[2] || DEFAULT_ORIGIN;
let SITE;

try {
  SITE = new URL(rawOrigin);
} catch {
  throw new Error(`Invalid site URL: ${rawOrigin}`);
}

if (
  SITE.protocol !== 'https:' ||
  SITE.username ||
  SITE.password ||
  SITE.search ||
  SITE.hash
) {
  throw new Error(
    'The site URL must be HTTPS and must not contain credentials, a query, or a fragment.'
  );
}

SITE.pathname = SITE.pathname.replace(/\/+$/, '') + '/';

const SITE_BASE_PATH =
  SITE.pathname.replace(/\/+$/, '');

if (!fs.existsSync(DOCS)) {
  throw new Error(`Docs directory not found: ${DOCS}`);
}

// Read pages from docs/ and all its subdirectories.
collectHtmlFiles(DOCS);

// Homepage first; then alphabetical order.
const HOME_URL = SITE.origin + SITE_BASE_PATH + '/';

included.sort((a, b) => {
  if (a.url === HOME_URL) return -1;
  if (b.url === HOME_URL) return 1;

  return a.url.localeCompare(b.url);
});

if (included.length > MAX_URLS) {
  throw new Error(
    `Found ${included.length} URLs. A sitemap can contain at most ${MAX_URLS} URLs.`
  );
}

// Generate standard sitemap XML. No stylesheet is required.
const lines = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
];

for (const entry of included) {
  lines.push('  <url>');
  lines.push(`    <loc>${escapeXml(entry.url)}</loc>`);
  lines.push(`    <lastmod>${entry.lastmod}</lastmod>`);
  lines.push('  </url>');
}

lines.push('</urlset>', '');

const xml = lines.join('\n');
const size = Buffer.byteLength(xml, 'utf8');

if (size > MAX_BYTES) {
  throw new Error(
    'Sitemap exceeds the 50 MB uncompressed size limit.'
  );
}

// Save the completed sitemap.
fs.writeFileSync(OUTPUT, xml, 'utf8');

log(`Generated: ${OUTPUT}`);
log(`Site: ${SITE.origin}${SITE_BASE_PATH}/`);
log(`Included URLs: ${included.length}`);
log(`File size: ${size} bytes`);

for (const entry of included) {
  log(`  ${entry.url}`);
}

if (excluded.length > 0) {
  log(`Excluded pages: ${excluded.length}`);

  for (const item of excluded) {
    log(`  ${item}`);
  }
}
