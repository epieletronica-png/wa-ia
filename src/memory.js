import Redis from "ioredis";

/**
 * Redis is optional.
 * - If REDIS_URL is not set, we fallback to in-memory storage (good for testing).
 * - If Redis is down/unreachable, we DON'T crash the whole bot; we log and fallback.
 *
 * IMPORTANT: In production you should set REDIS_URL, otherwise state will reset on each restart.
 */

const TTL = 60 * 60 * 24; // 24h

// -------------------- In-memory fallback (with TTL) --------------------
const memory = new Map(); // key -> { value: string, exp: number|null }

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function memGet(key) {
  const item = memory.get(key);
  if (!item) return null;
  if (item.exp !== null && item.exp <= nowSec()) {
    memory.delete(key);
    return null;
  }
  return item.value;
}

function memSet(key, value, ttlSec) {
  const exp = typeof ttlSec === "number" ? nowSec() + ttlSec : null;
  memory.set(key, { value, exp });
}

function memDel(key) {
  memory.delete(key);
}

function memKeys(prefix) {
  const out = [];
  for (const k of memory.keys()) {
    if (k.startsWith(prefix)) out.push(k);
  }
  return out;
}

// -------------------- Redis (optional) --------------------
let redis = null;
let redisEnabled = false;

function initRedis() {
  const url = process.env.REDIS_URL;
  if (!url) return null;

  try {
    // If you ever need TLS, set REDIS_TLS=true (some providers require it).
    const useTLS = String(process.env.REDIS_TLS || "").toLowerCase() === "true";

    redis = new Redis(url, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      retryStrategy: (times) => Math.min(times * 200, 2000),
      ...(useTLS ? { tls: {} } : {}),
    });

    // IMPORTANT: Prevent crashes due to unhandled 'error' event.
    redis.on("error", (err) => {
      console.error("[redis] error:", err?.message || err);
    });

    redis.on("ready", () => {
      redisEnabled = true;
      console.log("[redis] ready");
    });

    redis.on("end", () => {
      redisEnabled = false;
      console.log("[redis] connection ended");
    });

    return redis;
  } catch (err) {
    console.error("[redis] init failed:", err?.message || err);
    redis = null;
    redisEnabled = false;
    return null;
  }
}

initRedis();

async function safeRedisGet(key) {
  if (!redis) return null;
  try {
    return await redis.get(key);
  } catch (err) {
    console.error("[redis] get failed:", err?.message || err);
    return null;
  }
}

async function safeRedisSet(key, value, ttlSec) {
  if (!redis) return false;
  try {
    await redis.set(key, value, "EX", ttlSec);
    return true;
  } catch (err) {
    console.error("[redis] set failed:", err?.message || err);
    return false;
  }
}

async function safeRedisDel(key) {
  if (!redis) return false;
  try {
    await redis.del(key);
    return true;
  } catch (err) {
    console.error("[redis] del failed:", err?.message || err);
    return false;
  }
}

async function safeRedisKeys(pattern) {
  if (!redis) return [];
  try {
    return await redis.keys(pattern);
  } catch (err) {
    console.error("[redis] keys failed:", err?.message || err);
    return [];
  }
}

// -------------------- Public API --------------------
export async function getContext(user) {
  const key = `ctx:${user}`;
  const data = await safeRedisGet(key);
  if (data) return JSON.parse(data);

  const mem = memGet(key);
  return mem ? JSON.parse(mem) : [];
}

export async function saveContext(user, ctx) {
  const key = `ctx:${user}`;
  const payload = JSON.stringify(ctx.slice(-10));

  const ok = await safeRedisSet(key, payload, TTL);
  if (!ok) memSet(key, payload, TTL);
}

export async function getMode(user) {
  const key = `mode:${user}`;
  const v = await safeRedisGet(key);
  if (v) return v;

  return memGet(key) || "AI";
}

export async function setMode(user, mode) {
  const key = `mode:${user}`;
  const ok = await safeRedisSet(key, mode, TTL);
  if (!ok) memSet(key, mode, TTL);
}

export async function openTicket(user) {
  const key = `ticket:${user}`;
  const ok = await safeRedisSet(key, "OPEN", TTL);
  if (!ok) memSet(key, "OPEN", TTL);
}

export async function closeTicket(user) {
  const key = `ticket:${user}`;
  const ok = await safeRedisDel(key);
  if (!ok) memDel(key);
  await setMode(user, "AI");
}

export async function listTickets() {
  // Redis: scan by KEYS; in-memory: iterate keys
  const keys = redis ? await safeRedisKeys("ticket:*") : memKeys("ticket:");
  return keys.map((k) => k.replace("ticket:", ""));
}

// Prévia de mensagem do atendente (expira em 15 minutos)
export async function savePreview(user, text) {
  const key = `preview:${user}`;
  const ok = await safeRedisSet(key, text, 60 * 15);
  if (!ok) memSet(key, text, 60 * 15);
}

export async function getPreview(user) {
  const key = `preview:${user}`;
  const v = await safeRedisGet(key);
  if (v) return v;
  return memGet(key);
}

export async function clearPreview(user) {
  const key = `preview:${user}`;
  const ok = await safeRedisDel(key);
  if (!ok) memDel(key);
}
