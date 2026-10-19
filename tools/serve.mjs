#!/usr/bin/env node
/**
 * serve.mjs
 *
 * A local preview server for docs/. No dependencies, no install step.
 *
 *   node tools/serve.mjs          # http://localhost:8000
 *   node tools/serve.mjs 3000     # pick the port
 *
 * GitHub Pages serves docs/ from the site root, so this serves it from the site
 * root too. Checking against a server rather than opening the file directly
 * matters: relative paths, the sitemap and robots.txt only resolve correctly
 * when the folder is mounted at the root.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'docs');
const PORT = Number(process.argv[2]) || 8000;

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
    // XSLT must be served with an XML MIME type. A browser will refuse to apply
    // a stylesheet delivered as application/octet-stream, and then the sitemap
    // falls back to showing raw XML.
    '.xsl': 'application/xml; charset=utf-8',
    '.xslt': 'application/xml; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
    let urlPath;
    try {
        urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
        res.writeHead(400).end('Bad request');
        return;
    }

    if (urlPath.endsWith('/')) urlPath += 'index.html';

    // Contain everything inside docs/. No traversal out of the served root.
    const target = path.join(DOCS, path.normalize(urlPath));
    if (!target.startsWith(DOCS)) {
        res.writeHead(403).end('Forbidden');
        return;
    }

    fs.readFile(target, (err, buf) => {
        if (err) {
            // Mirror Pages: unknown paths get the 404 page with a 404 status.
            fs.readFile(path.join(DOCS, '404.html'), (e2, page) => {
                if (e2) {
                    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
                    return;
                }
                res.writeHead(404, { 'Content-Type': TYPES['.html'] }).end(page);
            });
            return;
        }
        const type = TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream';
        res.writeHead(200, {
            'Content-Type': type,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff'
        });
        res.end(buf);
    });
});

server.listen(PORT, () => {
    console.log(`Previewing docs/ at http://localhost:${PORT}/`);
    console.log('Ctrl+C to stop.');
});