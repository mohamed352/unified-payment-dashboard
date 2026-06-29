const fs = require('fs');
const path = require('path');

let Redis;
try {
  ({ Redis } = require('@upstash/redis'));
} catch {
  Redis = null;
}

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

let redis = null;
if (Redis && REDIS_URL && REDIS_TOKEN) {
  redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });
  console.log('[PaymentStore] Using Upstash Redis.');
} else {
  console.log('[PaymentStore] Using local JSON file storage.');
}

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'payments.json');
const MAX_RECORDS = 1000;

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');
}

function readLocal() {
  ensureDataFile();
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeLocal(records) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(records.slice(-MAX_RECORDS), null, 2));
}

async function addPayment(record) {
  if (redis) {
    await redis.set(`unified:payment:${record.reference}`, JSON.stringify(record));
    await redis.lpush('unified:payments:refs', record.reference);
    await redis.ltrim('unified:payments:refs', 0, MAX_RECORDS - 1);
    return;
  }

  const records = readLocal();
  records.push(record);
  writeLocal(records);
}

async function updatePayment(reference, updates) {
  if (redis) {
    const existing = await redis.get(`unified:payment:${reference}`);
    if (!existing) return;
    const record = JSON.parse(existing);
    Object.assign(record, updates, { updatedAt: new Date().toISOString() });
    await redis.set(`unified:payment:${reference}`, JSON.stringify(record));
    return;
  }

  const records = readLocal();
  const idx = records.findIndex((r) => r.reference === reference);
  if (idx !== -1) {
    Object.assign(records[idx], updates, { updatedAt: new Date().toISOString() });
    writeLocal(records);
  }
}

async function listPayments(limit = 100) {
  if (redis) {
    const refs = await redis.lrange('unified:payments:refs', 0, limit - 1);
    const records = [];
    for (const ref of refs) {
      const raw = await redis.get(`unified:payment:${ref}`);
      if (raw) records.push(JSON.parse(raw));
    }
    return records;
  }

  return readLocal().reverse().slice(0, limit);
}

async function getStats() {
  const payments = await listPayments(MAX_RECORDS);
  const stats = {
    total: payments.length,
    success: 0,
    failed: 0,
    pending: 0,
    perGateway: {},
  };

  for (const p of payments) {
    if (p.status === 'success') stats.success += 1;
    else if (p.status === 'failed') stats.failed += 1;
    else stats.pending += 1;

    const gateway = p.gateway || 'unknown';
    if (!stats.perGateway[gateway]) {
      stats.perGateway[gateway] = { success: 0, failed: 0, pending: 0, total: 0 };
    }
    stats.perGateway[gateway].total += 1;
    if (p.status === 'success') stats.perGateway[gateway].success += 1;
    else if (p.status === 'failed') stats.perGateway[gateway].failed += 1;
    else stats.perGateway[gateway].pending += 1;
  }

  return stats;
}

module.exports = { addPayment, updatePayment, listPayments, getStats };
