#!/usr/bin/env node

/**
 * Instant SEO Ping Script for blog.yunitytech.top
 * - Microsoft Bing: Pushes all URLs directly via IndexNow protocol (api.indexnow.org)
 * - Google: Crawls sitemap.xml automatically via Google Search Console & robots.txt
 *   (Note: Google deprecated and closed its public sitemap ping endpoint in late 2023)
 * - Baidu: Optional active push if BAIDU_TOKEN environment variable is set
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const HOST = 'blog.yunitytech.top';
const KEY = '9f8e4b7a1c2d3e4f5a6b7c8d9e0f1a2b';
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;
const SITEMAP_URL = `https://${HOST}/sitemap.xml`;

// Extract all URLs dynamically: first check dist/sitemap.xml, then parse src/content/posts directory
function getUrlList() {
  const distSitemap = path.resolve(__dirname, '../dist/sitemap.xml');
  const rootSitemap = path.resolve(__dirname, '../sitemap.xml');
  const sitemapPath = fs.existsSync(distSitemap) ? distSitemap : (fs.existsSync(rootSitemap) ? rootSitemap : null);

  if (sitemapPath) {
    try {
      const content = fs.readFileSync(sitemapPath, 'utf8');
      const matches = [...content.matchAll(/<loc>(https:\/\/[^<]+)<\/loc>/g)].map(m => m[1].trim());
      if (matches && matches.length > 0) {
        return [...new Set(matches)];
      }
    } catch (err) {
      console.warn(`[SEO Ping] Could not read sitemap.xml dynamically (${err.message}). Trying filesystem...`);
    }
  }

  // Fallback: Read directly from src/content/posts directory (works in CI without prior build step)
  try {
    const postsDir = path.resolve(__dirname, '../src/content/posts');
    if (fs.existsSync(postsDir)) {
      const files = fs.readdirSync(postsDir);
      const postUrls = files
        .filter(f => f.endsWith('.md') || f.endsWith('.mdx'))
        .map(f => `https://${HOST}/post/${f.replace(/\.(md|mdx)$/, '')}/`);

      const staticUrls = [
        `https://${HOST}/`,
        `https://${HOST}/about/`,
        `https://${HOST}/post/`
      ];
      return [...new Set([...staticUrls, ...postUrls])];
    }
  } catch (err) {
    console.warn(`[SEO Ping] Could not scan src/content/posts (${err.message}).`);
  }

  return [
    `https://${HOST}/`,
    `https://${HOST}/about/`,
    `https://${HOST}/post/`,
    `https://${HOST}/post/ai-code-review-delivery-pipeline/`,
    `https://${HOST}/post/refreshscope-scheduled-duplicate-rca/`,
    `https://${HOST}/post/ai-coding-era-engineer-survival/`,
    `https://${HOST}/post/simple-seata-at-mode/`,
    `https://${HOST}/post/agent-programming-language-benchmark/`,
    `https://${HOST}/post/agent-programming-sdd-tdd/`,
    `https://${HOST}/post/small-rpc-v3-governance/`,
    `https://${HOST}/post/maven-central-publish-guide/`,
    `https://${HOST}/post/small-rpc-intro/`,
    `https://${HOST}/post/openobserve-three-prs/`,
    `https://${HOST}/post/glogcenter-two-prs/`,
    `https://${HOST}/post/jooq-postgis-intro/`
  ];
}

const URL_LIST = getUrlList();

// 1. Submit to IndexNow (Bing / Yandex / Naver)
function submitIndexNow() {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      host: HOST,
      key: KEY,
      keyLocation: KEY_LOCATION,
      urlList: URL_LIST
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
        if (data) console.log(`[IndexNow] Message:`, data);
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
function submitBaidu() {
  return new Promise((resolve) => {
    const token = process.env.BAIDU_TOKEN;
    if (!token) {
      console.log('[Baidu] Note: BAIDU_TOKEN env not set. Skipping Baidu active push.');
      resolve(null);
      return;
    }

    const payload = URL_LIST.join('\n');
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
        console.log(`[Baidu] Response:`, data);
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
  console.log(`Broadcasting ${URL_LIST.length} URLs to search engine indexers...`);
  await Promise.all([
    submitIndexNow(),
    submitBaidu()
  ]);
  console.log('SEO ping broadcast completed.');
}

main();
