
#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

const DOCS = path.join(ROOT, 'docs');
const OUTPUT = path.join(DOCS, 'sitemap.xml');

const SITE_URL =
  process.argv[2] ||
  'https://muqeet-1138.github.io/Anime-Array/';

const PRIORITY = '1.0';
const CHANGEFREQ = 'daily';
const MAX_URLS = 50000;
const MAX_BYTES = 50 * 1024 * 1024;

const site = new URL(SITE_URL);

if (
  site.protocol !== 'https:' ||
  site.username ||
  site.password ||
  site.search ||
  site.hash
) {
  throw new Error('SITE_URL must be a valid HTTPS URL.');
}

site.pathname = site.pathname.replace(/\/+$/, '') + '/';

const BASE_PATH = site.pathname.replace(/\/+$/, '');
const ORIGIN = site.origin;

const included = [];
const excluded = [];
const seen = new Set();

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

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

function getAttribute(tag, name) {
  const regex = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    'i'
  );

  const match = tag.match(regex);

  return match
    ? match[1] ?? match[2] ?? match[3] ?? ''
    : null;
}

function isVerificationFile(filename) {
  return (
    /^google[0-9a-f]+\.html$/i.test(filename) ||
    /verification/i.test(filename)
  );
}

function hasNoindex(html) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];

  return tags.some((tag) => {
    const name = getAttribute(tag, 'name');
    const content = getAttribute(tag, 'content');

    return (
      name?.toLowerCase() === 'robots' &&
      /(?:^|[\s,])noindex(?:$|[\s,])/i.test(content || '')
    );
  });
}

function getCanonical(html) {
  const tags = html.match(/<link\b[^>]*>/gi) || [];

  for (const tag of tags) {
    const rel = getAttribute(tag, 'rel');
    const href = getAttribute(tag, 'href');

    if (
      rel &&
      rel.toLowerCase().split(/\s+/).includes('canonical') &&
      href
    ) {
      return decodeEntities(href.trim());
    }
  }

  return null;
}

function processPage(fullPath, relativePath) {
  const filename = path.basename(fullPath);

  if (
    filename.toLowerCase() === '404.html' ||
    isVerificationFile(filename)
  ) {
    excluded.push(`${relativePath}: excluded file`);
    return;
  }

  const html = fs.readFileSync(fullPath, 'utf8');

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

  if (
    url.protocol !== 'https:' ||
    url.origin !== ORIGIN ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    excluded.push(`${relativePath}: invalid canonical URL`);
    return;
  }

  if (
    BASE_PATH &&
    url.pathname !== BASE_PATH &&
    !url.pathname.startsWith(BASE_PATH + '/')
  ) {
    excluded.push(`${relativePath}: outside site base path`);
    return;
  }

  if (/\s/.test(url.href)) {
    excluded.push(`${relativePath}: whitespace in URL`);
    return;
  }

  if (seen.has(url.href)) {
    excluded.push(`${relativePath}: duplicate canonical URL`);
    return;
  }

  seen.add(url.href);

  const lastmod = fs.statSync(fullPath)
    .mtime
    .toISOString()
    .replace(/\.\d{3}Z$/, '+00:00');

  included.push({
    file: relativePath,
    url: url.href,
    lastmod,
  });
}

function scanDirectory(directory, relative = '') {
  for (const entry of fs.readdirSync(directory, {
    withFileTypes: true,
  })) {
    const fullPath = path.join(directory, entry.name);
    const relativePath = path.posix.join(relative, entry.name);

    if (entry.isDirectory()) {
      if (
        entry.name !== '.git' &&
        entry.name !== 'node_modules'
      ) {
        scanDirectory(fullPath, relativePath);
      }

      continue;
    }

    if (
      entry.isFile() &&
      /\.html?$/i.test(entry.name)
    ) {
      processPage(fullPath, relativePath);
    }
  }
}

if (!fs.existsSync(DOCS)) {
  throw new Error(`Directory not found: ${DOCS}`);
}

scanDirectory(DOCS);

const HOME_URL = `${ORIGIN}${BASE_PATH}/`;

included.sort((a, b) => {
  if (a.url === HOME_URL) return -1;
  if (b.url === HOME_URL) return 1;

  return a.url.localeCompare(b.url);
});

if (included.length > MAX_URLS) {
  throw new Error('Sitemap exceeds the 50,000 URL limit.');
}

const lines = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<?xml-stylesheet type="text/xsl" href="sitemap.xsl"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
];

for (const entry of included) {
  lines.push('  <url>');
  lines.push(`    <loc>${escapeXml(entry.url)}</loc>`);
  lines.push(`    <priority>${PRIORITY}</priority>`);
  lines.push(`    <changefreq>${CHANGEFREQ}</changefreq>`);
  lines.push(`    <lastmod>${entry.lastmod}</lastmod>`);
  lines.push('  </url>');
}

lines.push('</urlset>', '');

const xml = lines.join('\n');
const size = Buffer.byteLength(xml, 'utf8');

if (size > MAX_BYTES) {
  throw new Error('Sitemap exceeds the 50 MB size limit.');
}

// Write clean UTF-8 XML with no BOM or leading whitespace.
fs.writeFileSync(OUTPUT, xml, {
  encoding: 'utf8',
  flag: 'w',
});

console.log('\nSitemap generated successfully!');
console.log(`Site: ${SITE_URL}`);
console.log(`URLs included: ${included.length}`);
console.log(`Output: ${OUTPUT}`);

for (const entry of included) {
  console.log(`  ${entry.url}`);
}

if (excluded.length) {
  console.log(`\nExcluded: ${excluded.length}`);

  for (const item of excluded) {
    console.log(`  ${item}`);
  }
}
