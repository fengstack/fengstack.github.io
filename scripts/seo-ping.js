#!/usr/bin/env node

/**
 * Instant SEO Ping Script for blog.yunitytech.top
 * - Microsoft Bing: Pushes all URLs directly via IndexNow protocol (api.indexnow.org)
 * - Google: Crawls sitemap.xml automatically via Google Search Console & robots.txt
 *   (Note: Google deprecated and closed its public sitemap ping endpoint in late 2023)
 * - Baidu: Optional active push if BAIDU_TOKEN environment variable is set
 */

import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HOST = process.env.INDEXNOW_HOST || 'blog.yunitytech.top';
const KEY = process.env.INDEXNOW_KEY || '9f8e4b7a1c2d3e4f5a6b7c8d9e0f1a2b';
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;

export function isDraftPost(markdownContent) {
  const fmMatch = markdownContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return false;
  return /^\s*draft:\s*true\s*(?:#.*)?$/im.test(fmMatch[1]);
}

export function getTopicUrls() {
  const topicsPath = path.resolve(__dirname, '../src/data/topics.ts');
  if (!fs.existsSync(topicsPath)) return [];

  const content = fs.readFileSync(topicsPath, 'utf8');
  const slugs = [...content.matchAll(/slug:\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
  return slugs.map(slug => `https://${HOST}/topic/${slug}/`);
}

function collectPostFiles(dir, baseDir = dir, result = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectPostFiles(fullPath, baseDir, result);
    } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.mdx'))) {
      result.push({
        fullPath,
        relSlug: path.relative(baseDir, fullPath).split(path.sep).join('/').replace(/\.(md|mdx)$/, ''),
      });
    }
  }
  return result;
}

export function getPostUrls() {
  const postsDir = path.resolve(__dirname, '../src/content/posts');
  if (!fs.existsSync(postsDir)) return [];

  return collectPostFiles(postsDir)
    .filter(({ fullPath }) => {
      const content = fs.readFileSync(fullPath, 'utf8');
      return !isDraftPost(content);
    })
    .map(({ relSlug }) => `https://${HOST}/post/${relSlug}/`);
}

export function getFallbackUrlList() {
  const staticUrls = [
    `https://${HOST}/`,
    `https://${HOST}/about/`,
    `https://${HOST}/post/`,
    `https://${HOST}/topic/`,
  ];

  try {
    const topicUrls = getTopicUrls();
    const postUrls = getPostUrls();
    return [...new Set([...staticUrls, ...topicUrls, ...postUrls])];
  } catch (err) {
    console.warn(`[SEO Ping] Could not scan source files (${err.message}).`);
    return staticUrls;
  }
}

// Extract all URLs dynamically: first check dist/sitemap.xml, then fallback to source files
export function getUrlList() {
  const distSitemap = path.resolve(__dirname, '../dist/sitemap.xml');
  const rootSitemap = path.resolve(__dirname, '../sitemap.xml');
  const sitemapPath = fs.existsSync(distSitemap) ? distSitemap : (fs.existsSync(rootSitemap) ? rootSitemap : null);

  if (sitemapPath) {
    try {
      const content = fs.readFileSync(sitemapPath, 'utf8');
      const matches = [...content.matchAll(/<loc>(https:\/\/[^<]+)<\/loc>/g)].map(m => m[1].trim());
      if (matches.length > 0) {
        return [...new Set(matches)];
      }
    } catch (err) {
      console.warn(`[SEO Ping] Could not read sitemap.xml dynamically (${err.message}). Falling back to source files...`);
    }
  }

  return getFallbackUrlList();
}

// 1. Submit to IndexNow (Bing / Yandex / Naver)
function submitIndexNow(urlList) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      host: HOST,
      key: KEY,
      keyLocation: KEY_LOCATION,
      urlList
    });

    const options = {
      hostname: 'api.indexnow.org',
      port: 443,
      path: '/indexnow',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        console.log(`[IndexNow] Response code: ${res.statusCode} (${res.statusCode === 200 || res.statusCode === 202 ? 'Success / Accepted' : 'Check status'})`);
        if (data) console.log('[IndexNow] Message:', data);
        resolve(res.statusCode);
      });
    });

    req.on('error', (e) => {
      console.error(`[IndexNow] Error: ${e.message}`);
      resolve(null);
    });

    req.write(payload);
    req.end();
  });
}

// 2. Submit to Baidu Active Push (if token provided)
function submitBaidu(urlList) {
  return new Promise((resolve) => {
    const token = process.env.BAIDU_TOKEN;
    if (!token) {
      console.log('[Baidu] Note: BAIDU_TOKEN env not set. Skipping Baidu active push.');
      resolve(null);
      return;
    }

    const payload = urlList.join('\n');
    const options = {
      hostname: 'data.zz.baidu.com',
      port: 443,
      path: `/urls?site=https://${HOST}&token=${token}`,
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        console.log(`[Baidu] Response code: ${res.statusCode}`);
        console.log('[Baidu] Response:', data);
        resolve(res.statusCode);
      });
    });

    req.on('error', (e) => {
      console.error(`[Baidu] Error: ${e.message}`);
      resolve(null);
    });

    req.write(payload);
    req.end();
  });
}

async function main() {
  const urlList = getUrlList();
  console.log(`Broadcasting ${urlList.length} URLs to search engine indexers...`);
  await Promise.all([
    submitIndexNow(urlList),
    submitBaidu(urlList)
  ]);
  console.log('SEO ping broadcast completed.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}
