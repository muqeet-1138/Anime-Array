
#!/usr/bin/env node

/**
 * Anime Array XML Sitemap Generator
 *
 * Run from repository root:
 *   node tools/make-sitemap.mjs
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

// Change this if your site uses a custom domain.
const SITE_URL =
  process.argv[2] ||
  'https://muqeet-1138.github.io/Anime-Array/';

// Configure the sitemap display metadata.
const DEFAULT_PRIORITY = '1.0';
const DEFAULT_CHANGEFREQ = 'daily';

const EXCLUDED_FILES = new Set([
  '404.html',
]);

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
  throw new Error(
    'SITE_URL must be a valid HTTPS URL without credentials, query or fragment.'
  );
}

site.pathname = site.pathname.replace(/\/+$/, '') + '/';

const siteBasePath = site.pathname.replace(/\/+$/, '');
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
  const regex = new RegExp(
    `(?:^|\\s)${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
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
      return decodeHtmlEntities(href.trim());
    }
  }

  return null;
}

function collectPages(directory, relative = '') {
  const entries = fs.readdirSync(directory, {
    withFileTypes: true,
  });

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.posix.join(relative, entry.name);

    if (entry.isDirectory()) {
      if (
        !['.git', 'node_modules'].includes(entry.name)
      ) {
        collectPages(absolutePath, relativePath);
      }

      continue;
    }

    if (
      !entry.isFile() ||
      !/\.html?$/i.test(entry.name)
    ) {
      continue;
    }

    if (
      EXCLUDED_FILES.has(entry.name.toLowerCase()) ||
      isVerificationFile(entry.name)
    ) {
      excluded.push(`${relativePath}: excluded file`);
      continue;
    }

    processPage(absolutePath, relativePath);
  }
}

function processPage(absolutePath, relativePath) {
  const html = fs.readFileSync(absolutePath, 'utf8');

  if (hasNoindex(html)) {
    excluded.push(`${relativePath}: noindex`);
    return;
  }

  const canonical = getCanonical(html);

  if (!canonical) {
    excluded.push(`${relativePath}: missing canonical`);
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
    url.origin !== site.origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    excluded.push(`${relativePath}: invalid canonical URL`);
    return;
  }

  if (
    siteBasePath &&
    url.pathname !== siteBasePath &&
    !url.pathname.startsWith(siteBasePath + '/')
  ) {
    excluded.push(`${relativePath}: outside site base path`);
    return;
  }

  if (/\s/.test(url.href)) {
    excluded.push(`${relativePath}: URL contains whitespace`);
    return;
  }

  if (seen.has(url.href)) {
    excluded.push(`${relativePath}: duplicate canonical URL`);
    return;
  }

  seen.add(url.href);

  // ISO 8601 format with an explicit UTC offset.
  const lastmod = fs.statSync(absolutePath)
    .mtime
    .toISOString()
    .replace(/\.\d{3}Z$/, '+00:00');

  included.push({
    file: relativePath,
    url: url.href,
    lastmod,
    priority: DEFAULT_PRIORITY,
    changefreq: DEFAULT_CHANGEFREQ,
  });
}

if (!fs.existsSync(DOCS)) {
  throw new Error(`Docs directory not found: ${DOCS}`);
}

collectPages(DOCS);

// Homepage first, then alphabetical.
const homepage = new URL(siteBasePath + '/', site.origin).href;

included.sort((a, b) => {
  if (a.url === homepage) return -1;
  if (b.url === homepage) return 1;
  return a.url.localeCompare(b.url);
});

if (included.length > MAX_URLS) {
  throw new Error(
    'Sitemap exceeds 50,000 URLs. Generate a sitemap index.'
  );
}

// Generate XML with a stylesheet reference.
// The XSL file must be deployed beside sitemap.xml.
const lines = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<?xml-stylesheet type="text/xsl" href="sitemap.xsl"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
];

for (const entry of included) {
  lines.push('  <url>');
  lines.push(`    <loc>${escapeXml(entry.url)}</loc>`);
  lines.push(`    <priority>${entry.priority}</priority>`);
  lines.push(`    <changefreq>${entry.changefreq}</changefreq>`);
  lines.push(`    <lastmod>${entry.lastmod}</lastmod>`);
  lines.push('  </url>');
}

lines.push('</urlset>', '');

const xml = lines.join('\n');
const bytes = Buffer.byteLength(xml, 'utf8');

if (bytes > MAX_BYTES) {
  throw new Error('Sitemap exceeds the 50 MB size limit.');
}

fs.writeFileSync(OUTPUT, xml, 'utf8');

console.log('\nXML Sitemap generated successfully!');
console.log(`URL: ${site.href}`);
console.log(`Included pages: ${included.length}`);
console.log(`Output: ${OUTPUT}`);

for (const entry of included) {
  console.log(`  ${entry.url}`);
}

if (excluded.length) {
  console.log(`\nExcluded pages: ${excluded.length}`);

  for (const item of excluded) {
    console.log(`  ${item}`);
  }
}
