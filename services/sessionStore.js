const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let Redis;
try {
  ({ Redis } = require('@upstash/redis'));
} catch {
  Redis = null;
}

const secret = process.env.PAYMENT_SESSION_SECRET || 'default-secret-must-be-32-bytes!';
const key = crypto.createHash('sha256').update(secret).digest();

const SESSION_TTL_SECONDS = 15 * 60;

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const tag = cipher.getAuthTag().toString('base64');
  return JSON.stringify({ iv: iv.toString('base64'), data: encrypted, tag });
}

function decrypt(payload) {
  const { iv, data, tag } = JSON.parse(payload);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  let decrypted = decipher.update(data, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

let redis = null;
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

if (Redis && REDIS_URL && REDIS_TOKEN) {
  redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });
  console.log('[SessionStore] Using Upstash Redis.');
} else if (process.env.VERCEL) {
  console.log('[SessionStore] Using /tmp file session store.');
} else {
  console.log('[SessionStore] Using in-memory session store.');
}

const TMP_FILE = '/tmp/unified-sessions.json';
const memory = new Map();

function readTmpStore() {
  try {
    if (!fs.existsSync(TMP_FILE)) return {};
    return JSON.parse(fs.readFileSync(TMP_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeTmpStore(store) {
  try {
    fs.writeFileSync(TMP_FILE, JSON.stringify(store));
  } catch (err) {
    console.error('[SessionStore] /tmp write failed:', err.message);
  }
}

function tmpCleanup(store) {
  const cutoff = Date.now() - SESSION_TTL_SECONDS * 1000;
  for (const id of Object.keys(store)) {
    if (store[id].createdAt < cutoff) delete store[id];
  }
}

function memoryCleanup() {
  const cutoff = Date.now() - SESSION_TTL_SECONDS * 1000;
  for (const [id, item] of memory) {
    if (item.createdAt < cutoff) memory.delete(id);
  }
}

async function createSession(obj) {
  memoryCleanup();
  const id = crypto.randomUUID();
  const encrypted = encrypt(JSON.stringify(obj));
  if (redis) {
    await redis.set(`unified:session:${id}`, encrypted, { ex: SESSION_TTL_SECONDS });
  } else if (process.env.VERCEL) {
    const store = readTmpStore();
    tmpCleanup(store);
    store[id] = { data: encrypted, createdAt: Date.now() };
    writeTmpStore(store);
  } else {
    memory.set(id, { data: encrypted, createdAt: Date.now() });
  }
  return id;
}

async function getSession(id) {
  let encrypted;
  if (redis) {
    encrypted = await redis.get(`unified:session:${id}`);
  } else if (process.env.VERCEL) {
    const store = readTmpStore();
    const item = store[id];
    if (item && Date.now() - item.createdAt < SESSION_TTL_SECONDS * 1000) {
      encrypted = item.data;
    }
  } else {
    const item = memory.get(id);
    if (item && Date.now() - item.createdAt < SESSION_TTL_SECONDS * 1000) {
      encrypted = item.data;
    }
  }
  if (!encrypted) return null;
  try {
    return JSON.parse(decrypt(encrypted));
  } catch (err) {
    console.error('[SessionStore] Decrypt failed:', err.message);
    return null;
  }
}

async function updateSession(id, obj) {
  const encrypted = encrypt(JSON.stringify(obj));
  if (redis) {
    await redis.set(`unified:session:${id}`, encrypted, { ex: SESSION_TTL_SECONDS });
  } else if (process.env.VERCEL) {
    const store = readTmpStore();
    tmpCleanup(store);
    store[id] = { data: encrypted, createdAt: Date.now() };
    writeTmpStore(store);
  } else {
    memory.set(id, { data: encrypted, createdAt: Date.now() });
  }
}

async function deleteSession(id) {
  if (redis) await redis.del(`unified:session:${id}`);
  if (process.env.VERCEL) {
    const store = readTmpStore();
    delete store[id];
    writeTmpStore(store);
  }
  memory.delete(id);
}

module.exports = { createSession, getSession, updateSession, deleteSession };
