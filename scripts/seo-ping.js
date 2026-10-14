#!/usr/bin/env node

/**
 * Instant SEO Ping Script for blog.yunitytech.top
 * Pushes all URLs to IndexNow (Microsoft Bing, Yandex, Seznam, Naver)
 * and optionally Baidu Active Push API if BAIDU_TOKEN env variable is set.
 */

const https = require('https');

const HOST = 'blog.yunitytech.top';
const KEY = '9f8e4b7a1c2d3e4f5a6b7c8d9e0f1a2b';
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;

const URL_LIST = [
  `https://${HOST}/`,
  `https://${HOST}/post/`,
  `https://${HOST}/post/small-rpc-intro/`,
  `https://${HOST}/post/openobserve-three-prs/`,
  `https://${HOST}/post/glogcenter-two-prs/`,
  `https://${HOST}/post/jooq-postgis-intro/`,
  `https://${HOST}/post/title_of_the_post/`,
  `https://${HOST}/tags/`,
  `https://${HOST}/categories/`
];

// 1. Submit to IndexNow (Bing / Yandex)
function submitIndexNow() {
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
    });
  });

  req.on('error', (e) => {
    console.error(`[IndexNow] Error: ${e.message}`);
  });

  req.write(payload);
  req.end();
}

// 2. Submit to Baidu Active Push (if token provided)
function submitBaidu() {
  const token = process.env.BAIDU_TOKEN;
  if (!token) {
    console.log('[Baidu] Note: BAIDU_TOKEN env not set. Set BAIDU_TOKEN to enable Baidu active push.');
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
    });
  });

  req.on('error', (e) => {
    console.error(`[Baidu] Error: ${e.message}`);
  });

  req.write(payload);
  req.end();
}

console.log(`Broadcasting ${URL_LIST.length} URLs to search engine indexers...`);
submitIndexNow();
submitBaidu();
