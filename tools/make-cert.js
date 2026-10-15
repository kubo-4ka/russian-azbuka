#!/usr/bin/env node
'use strict';
/*
 * ローカル確認用の自己署名証明書を作る（要 openssl）
 *   node tools/make-cert.js            … localhost と、このPCのLAN内IPv4アドレスを全部入れる
 *   node tools/make-cert.js 192.168.1.5 azbuka.local … 追加のIP・ホスト名を指定
 *
 * iOS は次の条件を満たさない証明書を受け付けないため、それに合わせています。
 *   - SAN（subjectAltName）にアクセスに使う IP / ホスト名が入っていること（CN だけでは不可）
 *   - 有効期間が 825 日以内であること
 *   - extendedKeyUsage に serverAuth があること
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = path.join(__dirname, 'certs');
fs.mkdirSync(dir, { recursive: true });

const localIPs = Object.values(os.networkInterfaces()).flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal)
  .map((i) => i.address);

const extra = process.argv.slice(2);
const isIP = (s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s);
const ips = [...new Set(['127.0.0.1', ...localIPs, ...extra.filter(isIP)])];
const hosts = [...new Set(['localhost', ...extra.filter((s) => !isIP(s))])];
const san = [...hosts.map((h) => `DNS:${h}`), ...ips.map((ip) => `IP:${ip}`)].join(',');

const key = path.join(dir, 'key.pem');
const cert = path.join(dir, 'cert.pem');

execFileSync('openssl', [
  'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256',
  '-days', '397',                       // iOS の上限 825 日より十分短く
  '-keyout', key, '-out', cert,
  '-subj', '/CN=russian-azbuka local',
  '-addext', `subjectAltName=${san}`,
  '-addext', 'extendedKeyUsage=serverAuth',
  '-addext', 'basicConstraints=critical,CA:TRUE'  // iPhone に「ルート証明書」として信頼させるため
], { stdio: ['ignore', 'ignore', 'inherit'] });

// iPhone 用は DER 形式にする（PEM のままだと「プロファイルが無効です」になりやすい）
execFileSync('openssl', ['x509', '-in', cert, '-outform', 'der', '-out', path.join(dir, 'cert.cer')]);
fs.copyFileSync(path.join(dir, 'cert.cer'), path.join(dir, 'cert.crt'));

console.log('証明書を作成しました:', dir);
console.log('  SAN:', san);
console.log('\n次のコマンドで HTTPS で起動できます:');
console.log('  node tools/serve.js --https');
