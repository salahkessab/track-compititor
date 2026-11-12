'use strict';
// Uses a new disposable object only. Does not start a worker or call an AI provider.
const { randomUUID, createHash } = require('node:crypto');
const { loadEnvConfig } = require('@next/env');
loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const { r2Config, R2Transport } = require('../.intelligence-build/lib/recipe-intelligence/r2.js');

async function main() {
  const config = r2Config();
  if (!config) throw new Error('disabled');
  const transport = new R2Transport(config);
  const key = `${config.prefix}/connection-checks/${randomUUID()}.txt`;
  const bytes = Buffer.from('Recipe Intelligence private storage connection check.\n');
  const hash = createHash('sha256').update(bytes).digest('hex');
  let removed = false;
  try {
    await transport.put(key, bytes, 'text/plain', hash);
    const head = await transport.head(key);
    if (head?.sha256 !== hash || head.size !== bytes.length) throw new Error('metadata');
    const restored = await transport.get(key, bytes.length);
    if (!restored.equals(bytes)) throw new Error('checksum');
    await transport.remove(key); removed = true;
    if (await transport.head(key)) throw new Error('cleanup');
    console.log(JSON.stringify({ passed: true, bucket: config.bucket, upload: true, checksumReadback: true, disposableObjectRemoved: true, aiRequests: 0 }));
  } finally {
    if (!removed) await transport.remove(key).catch(() => {});
  }
}
main().catch(error => {
  const status = Number(error?.$metadata?.httpStatusCode) || null;
  console.error(JSON.stringify({ passed: false, httpStatus: status, message: 'R2 connection check failed. Check enabled environment settings and bucket-scoped credentials. No AI requests were made.' }));
  process.exitCode = 1;
});
