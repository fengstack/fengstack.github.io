#!/usr/bin/env node

/**
 * Automated SEO Quality Assurance Verification Script
 * Validates the static build output in dist/ against SEO standards:
 * 1. robots.txt structure & sitemap directive
 * 2. sitemap.xml format, coverage, valid dates, uniqueness, and matching files
 * 3. 404.html noindex directive
 * 4. All published articles & pages:
 *    - Unique, non-empty <title> and <meta name="description">
 *    - Correct absolute canonical URLs with trailing slash
 *    - Valid JSON-LD (BlogPosting, BreadcrumbList, WebSite, Person)
 *    - Internal link integrity (zero 404 broken internal links)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.resolve(__dirname, '../dist');
const BASE_URL = 'https://blog.yunitytech.top';

let errors = [];
let warnings = [];
let passCount = 0;

function assert(condition, message) {
  if (!condition) {
    errors.push(message);
    console.error(`  ❌ [FAIL] ${message}`);
  } else {
    passCount++;
  }
}

function warn(message) {
  warnings.push(message);
  console.warn(`  ⚠️  [WARN] ${message}`);
}

function pass(message) {
  passCount++;
  console.log(`  ✅ [PASS] ${message}`);
}

// 1. Verify dist exists
if (!fs.existsSync(DIST_DIR)) {
  console.error(`Fatal: dist directory not found at ${DIST_DIR}. Run 'astro build' first.`);
  process.exit(1);
}

console.log('🔍 Starting SEO Quality Assurance Audit on dist/...\n');

// 2. Verify robots.txt
console.log('--- Checking robots.txt ---');
const robotsPath = path.join(DIST_DIR, 'robots.txt');
assert(fs.existsSync(robotsPath), 'dist/robots.txt must exist');
if (fs.existsSync(robotsPath)) {
  const robotsTxt = fs.readFileSync(robotsPath, 'utf8');
  assert(robotsTxt.includes('User-agent: *'), 'robots.txt must specify User-agent: *');
  assert(robotsTxt.includes('Allow: /'), 'robots.txt must allow root /');
  assert(
    robotsTxt.includes(`Sitemap: ${BASE_URL}/sitemap.xml`),
    `robots.txt must specify Sitemap: ${BASE_URL}/sitemap.xml`
  );
  pass('robots.txt format and directives verified');
}

// 3. Verify sitemap.xml
console.log('\n--- Checking sitemap.xml ---');
const sitemapPath = path.join(DIST_DIR, 'sitemap.xml');
assert(fs.existsSync(sitemapPath), 'dist/sitemap.xml must exist');

const sitemapUrls = [];
if (fs.existsSync(sitemapPath)) {
  const sitemapContent = fs.readFileSync(sitemapPath, 'utf8');
  assert(sitemapContent.startsWith('<?xml'), 'sitemap.xml must be valid XML declaration');
  assert(sitemapContent.includes('<urlset'), 'sitemap.xml must contain <urlset>');

  const locMatches = [...sitemapContent.matchAll(/<loc>(https:\/\/[^<]+)<\/loc>/g)].map(m => m[1]);
  assert(locMatches.length > 0, 'sitemap.xml must contain at least one <loc> entry');

  // Check uniqueness
  const uniqueUrls = new Set(locMatches);
  assert(uniqueUrls.size === locMatches.length, 'sitemap.xml must not contain duplicate URLs');

  // Check trailing slash and domain
  for (const url of locMatches) {
    sitemapUrls.push(url);
    assert(url.startsWith(BASE_URL), `Sitemap URL ${url} must start with ${BASE_URL}`);
    assert(url.endsWith('/'), `Sitemap URL ${url} must end with trailing slash`);

    // Verify corresponding HTML file exists in dist
    const relPath = url.replace(BASE_URL, '').replace(/^\//, '');
    const expectedHtml = path.join(DIST_DIR, relPath, 'index.html');
    assert(
      fs.existsSync(expectedHtml),
      `Sitemap URL ${url} points to missing static file: ${expectedHtml}`
    );
  }

  // Check lastmod format (YYYY-MM-DD)
  const lastmodMatches = [...sitemapContent.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map(m => m[1]);
  for (const dateStr of lastmodMatches) {
    assert(
      /^\d{4}-\d{2}-\d{2}$/.test(dateStr),
      `Invalid lastmod date format in sitemap: ${dateStr} (expected YYYY-MM-DD)`
    );
  }

  pass(`sitemap.xml contains ${locMatches.length} valid, unique URLs corresponding to dist HTML`);
}

// 4. Verify 404 page
console.log('\n--- Checking 404.html ---');
const errorPagePath = path.join(DIST_DIR, '404.html');
assert(fs.existsSync(errorPagePath), 'dist/404.html must exist');
if (fs.existsSync(errorPagePath)) {
  const html = fs.readFileSync(errorPagePath, 'utf8');
  assert(
    html.includes('<meta name="robots" content="noindex, follow" />') ||
    html.includes('content="noindex'),
    '404.html must include noindex meta robots directive'
  );
  pass('404.html properly marked with noindex');
}

// 5. Scan all HTML pages in dist
console.log('\n--- Checking HTML Pages Metadata & Structured Data ---');

function getAllHtmlFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      getAllHtmlFiles(filePath, fileList);
    } else if (file.endsWith('.html') && file !== '404.html') {
      fileList.push(filePath);
    }
  }
  return fileList;
}

const htmlFiles = getAllHtmlFiles(DIST_DIR);
const seenTitles = new Map();
const seenDescriptions = new Map();
let checkedPages = 0;

for (const filePath of htmlFiles) {
  const relPath = path.relative(DIST_DIR, filePath);
  const html = fs.readFileSync(filePath, 'utf8');
  checkedPages++;

  // 1. Title
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  assert(titleMatch && titleMatch[1].trim().length > 0, `Page ${relPath} missing or empty <title>`);
  if (titleMatch) {
    const title = titleMatch[1].trim();
    if (seenTitles.has(title) && !relPath.includes('index.html')) {
      warn(`Duplicate title "${title}" found in ${relPath} and ${seenTitles.get(title)}`);
    } else {
      seenTitles.set(title, relPath);
    }
  }

  // 2. Meta Description
  const descMatch = html.match(/<meta name="description" content="([^"]+)"/);
  assert(descMatch && descMatch[1].trim().length > 0, `Page ${relPath} missing or empty meta description`);
  if (descMatch) {
    const desc = descMatch[1].trim();
    if (seenDescriptions.has(desc) && relPath.startsWith('post/')) {
      warn(`Duplicate description in article ${relPath} and ${seenDescriptions.get(desc)}`);
    } else {
      seenDescriptions.set(desc, relPath);
    }
  }

  // 3. Canonical URL
  const canonicalMatch = html.match(/<link rel="canonical" href="([^"]+)"/);
  assert(canonicalMatch && canonicalMatch[1].startsWith(BASE_URL), `Page ${relPath} missing or invalid canonical URL`);
  if (canonicalMatch) {
    const cUrl = canonicalMatch[1];
    assert(cUrl.endsWith('/'), `Canonical URL ${cUrl} in ${relPath} must end with trailing slash`);
  }

  // 4. JSON-LD Parsing & Schema validation
  const jsonLdMatches = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
  assert(jsonLdMatches.length > 0, `Page ${relPath} missing JSON-LD structured data`);

  for (const match of jsonLdMatches) {
    try {
      const parsed = JSON.parse(match[1]);
      assert(parsed['@context'] === 'https://schema.org', `JSON-LD in ${relPath} must specify @context https://schema.org`);

      // If it's an article page
      if (relPath.startsWith('post/') && relPath !== 'post/index.html') {
        if (parsed['@type'] === 'BlogPosting') {
          assert(Boolean(parsed.headline), `BlogPosting in ${relPath} missing headline`);
          assert(Boolean(parsed.datePublished), `BlogPosting in ${relPath} missing datePublished`);
          assert(Boolean(parsed.author), `BlogPosting in ${relPath} missing author`);
        }
      }
    } catch (err) {
      assert(false, `Invalid JSON-LD syntax in ${relPath}: ${err.message}`);
    }
  }

  // 5. Internal link checking (href="/...")
  const internalLinkMatches = [...html.matchAll(/href="(\/[^"#?]*)"/g)].map(m => m[1]);
  for (const link of internalLinkMatches) {
    // Ignore static assets like /images/, /fonts/, etc.
    if (link.startsWith('/images/') || link.startsWith('/fonts/') || link.endsWith('.xml') || link.endsWith('.txt') || link.endsWith('.json')) {
      const assetPath = path.join(DIST_DIR, link.replace(/^\//, ''));
      assert(fs.existsSync(assetPath), `Broken asset link ${link} found in ${relPath}`);
      continue;
    }

    const cleanLink = link.replace(/\/$/, '');
    const possiblePaths = [
      path.join(DIST_DIR, cleanLink, 'index.html'),
      path.join(DIST_DIR, `${cleanLink}.html`),
      path.join(DIST_DIR, cleanLink),
    ];

    const exists = possiblePaths.some(p => fs.existsSync(p));
    assert(exists, `Broken internal link ${link} found in ${relPath}`);
  }
}

pass(`Audited ${checkedPages} static HTML pages for SEO title, description, canonical, and JSON-LD`);

// Summary
console.log('\n========================================');
console.log(`📊 Audit Summary: ${passCount} Checks Passed, ${warnings.length} Warnings, ${errors.length} Errors`);
console.log('========================================');

if (errors.length > 0) {
  console.error(`\n❌ SEO Audit Failed with ${errors.length} error(s). Please review the errors above.`);
  process.exit(1);
} else {
  console.log('\n🎉 All SEO Quality Assurance checks passed successfully!\n');
  process.exit(0);
}
