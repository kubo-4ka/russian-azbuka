#!/usr/bin/env node
'use strict';
/*
 * ローカル確認用の静的サーバ
 *   node tools/serve.js           … http://localhost:26834/
 *   node tools/serve.js --https   … https://localhost:26834/（tools/certs の証明書を使う）
 * PORT 環境変数でポートを変更できます。
 *
 * Service Worker（オフライン対応・ホーム画面アプリ）は https か localhost でしか動きません。
 * iPhone など他の端末から確認するときは --https を使ってください。
 * 証明書は `node tools/make-cert.js` で作れます。
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CERT_DIR = path.join(__dirname, 'certs');
const PORT = Number(process.env.PORT) || 26834;
const useHttps = process.argv.includes('--https') || process.env.HTTPS === '1';
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.crt': 'application/x-x509-ca-cert',
  '.cer': 'application/x-x509-ca-cert'
};
const CERT_PATHS = ['/cert.crt', '/cert.cer'];

function handler(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (p.endsWith('/')) p += 'index.html';

  // 証明書は iPhone にインストールさせるため、公開フォルダの外からでも配る
  const isCert = CERT_PATHS.includes(p);
  const file = isCert ? path.join(CERT_DIR, path.basename(p)) : path.join(ROOT, p);
  if (!isCert && !file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }

  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}

function addresses(scheme) {
  const ips = Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
  return [`${scheme}://localhost:${PORT}/`, ...ips.map((ip) => `${scheme}://${ip}:${PORT}/`)];
}

if (useHttps) {
  const key = path.join(CERT_DIR, 'key.pem');
  const cert = path.join(CERT_DIR, 'cert.pem');
  if (!fs.existsSync(key) || !fs.existsSync(cert)) {
    console.error('証明書がありません。先に `node tools/make-cert.js` を実行してください。');
    process.exit(1);
  }
  https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, handler).listen(PORT, () => {
    console.log('ロシア文字練習帳（HTTPS）');
    addresses('https').forEach((u) => console.log('  ' + u));
  });

  // 証明書だけは平文 HTTP でも配る。信頼していない HTTPS 経由でダウンロードすると
  // iPhone で「プロファイルが無効です」になることがあるため。
  http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (!CERT_PATHS.includes(p)) { res.writeHead(404); res.end('証明書は /cert.cer で配布しています'); return; }
    handler(req, res);
  }).listen(PORT + 1, () => {
    console.log('\niPhone 用の証明書（Safari で開く）:');
    addresses('http').forEach((u) => console.log('  ' + u.replace(':' + PORT + '/', ':' + (PORT + 1) + '/') + 'cert.cer'));
  });
} else {
  http.createServer(handler).listen(PORT, () => {
    console.log('ロシア文字練習帳');
    addresses('http').forEach((u) => console.log('  ' + u));
    console.log('\n※ 他の端末から Service Worker（オフライン・ホーム画面アプリ）を試すときは --https で起動してください。');
  });
}
