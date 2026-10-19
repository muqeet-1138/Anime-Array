<?xml version="1.0" encoding="UTF-8"?>
<!--
  Presentation for docs/sitemap.xml.

  Browsers do not have a built-in viewer for sitemaps, so a bare sitemap shows
  as raw XML. This stylesheet is what turns it into the four-column table that
  WordPress sitemap plugins show: URL, Priority, Change frequency, Last
  modified (GMT).

  This file affects only what a human sees when they open sitemap.xml in a
  browser. Crawlers ignore the stylesheet instruction and read the XML itself,
  so nothing here can affect how the sitemap is indexed.
-->
<xsl:stylesheet version="1.0"
                xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9"
                exclude-result-prefixes="sm">

  <xsl:output method="html" version="1.0" encoding="UTF-8" indent="yes"/>

  <xsl:template match="/">
    <html lang="en">
      <head>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <title>XML Sitemap</title>
        <style>
          :root { color-scheme: light dark; }
          body {
            font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
            margin: 0; padding: 28px 20px 60px; color: #1a1a1a; background: #fff;
          }
          .wrap { max-width: 1180px; margin: 0 auto; }
          h1 { font-size: 22px; margin: 0 0 6px; letter-spacing: -0.01em; }
          .lede { margin: 0 0 22px; color: #555; font-size: 13px; }
          .lede code { background: #f2f3f5; padding: 1px 5px; border-radius: 3px; font-size: 12px; }
          table { border-collapse: collapse; width: 100%; font-size: 13px; }
          caption { text-align: left; font-weight: 600; padding: 0 0 8px; color: #333; }
          th {
            background: #1a1a1a; color: #fff; text-align: left;
            padding: 9px 12px; font-weight: 600; font-size: 12px;
            letter-spacing: 0.02em; white-space: nowrap;
          }
          td { padding: 8px 12px; border-bottom: 1px solid #e4e6ea; vertical-align: top; }
          tbody tr:nth-child(even) { background: #fafbfc; }
          tbody tr:hover { background: #f0f6ff; }
          td.loc { word-break: break-all; }
          td.loc a { color: #0b57d0; text-decoration: none; }
          td.loc a:hover { text-decoration: underline; }
          td.num, td.freq, td.date { white-space: nowrap; color: #333; }
          td.date { font-variant-numeric: tabular-nums; }
          .foot { margin-top: 18px; font-size: 12px; color: #666; }
          @media (prefers-color-scheme: dark) {
            body { background: #101318; color: #e6e9ef; }
            .lede, .foot { color: #9aa3b2; }
            .lede code { background: #1c212b; color: #cfd6e2; }
            th { background: #232936; }
            td { border-bottom-color: #232936; }
            tbody tr:nth-child(even) { background: #151a21; }
            tbody tr:hover { background: #1b2230; }
            td.loc a { color: #7fb0ff; }
            td.num, td.freq, td.date { color: #c3cad6; }
          }
        </style>
      </head>
      <body>
        <div class="wrap">
          <h1>XML Sitemap</h1>
          <p class="lede">
            This is a sitemap for <code><xsl:value-of select="sm:urlset/sm:url[1]/sm:loc"/></code>.
            It lists pages that are available for crawling.
          </p>

          <table>
            <caption>
              <xsl:value-of select="count(sm:urlset/sm:url)"/>
              <xsl:choose>
                <xsl:when test="count(sm:urlset/sm:url) = 1"> URL</xsl:when>
                <xsl:otherwise> URLs</xsl:otherwise>
              </xsl:choose>
            </caption>
            <thead>
              <tr>
                <th scope="col">URL</th>
                <th scope="col">Priority</th>
                <th scope="col">Change frequency</th>
                <th scope="col">Last modified (GMT)</th>
              </tr>
            </thead>
            <tbody>
              <xsl:for-each select="sm:urlset/sm:url">
                <tr>
                  <td class="loc">
                    <a href="{sm:loc}"><xsl:value-of select="sm:loc"/></a>
                  </td>
                  <td class="num">
                    <xsl:choose>
                      <xsl:when test="sm:priority">
                        <xsl:value-of select="format-number(sm:priority * 100, '0')"/>%
                      </xsl:when>
                      <xsl:otherwise>&#8212;</xsl:otherwise>
                    </xsl:choose>
                  </td>
                  <td class="freq">
                    <xsl:choose>
                      <xsl:when test="sm:changefreq">
                        <xsl:value-of select="translate(substring(sm:changefreq, 1, 1), 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')"/>
                        <xsl:value-of select="substring(sm:changefreq, 2)"/>
                      </xsl:when>
                      <xsl:otherwise>&#8212;</xsl:otherwise>
                    </xsl:choose>
                  </td>
                  <td class="date">
                    <xsl:choose>
                      <xsl:when test="sm:lastmod"><xsl:value-of select="sm:lastmod"/></xsl:when>
                      <xsl:otherwise>&#8212;</xsl:otherwise>
                    </xsl:choose>
                  </td>
                </tr>
              </xsl:for-each>
            </tbody>
          </table>

          <p class="foot">
            Generated by <code>tools/make-sitemap.mjs</code>. This page is a
            browser rendering of the XML; search engines read the underlying file.
          </p>
        </div>
      </body>
    </html>
  </xsl:template>

</xsl:stylesheet>
