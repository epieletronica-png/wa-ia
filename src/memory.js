import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL);
const TTL = 60 * 60 * 24;

export async function getContext(user) {
  const data = await redis.get(`ctx:${user}`);
  return data ? JSON.parse(data) : [];
}

export async function saveContext(user, ctx) {
  await redis.set(`ctx:${user}`, JSON.stringify(ctx.slice(-10)), "EX", TTL);
}

export async function getMode(user) {
  return (await redis.get(`mode:${user}`)) || "AI";
}

export async function setMode(user, mode) {
  await redis.set(`mode:${user}`, mode, "EX", TTL);
}

export async function openTicket(user) {
  await redis.set(`ticket:${user}`, "OPEN", "EX", TTL);
}

export async function closeTicket(user) {
  await redis.del(`ticket:${user}`);
  await setMode(user, "AI");
}

export async function listTickets() {
  const keys = await redis.keys("ticket:*");
  return keys.map(k => k.replace("ticket:", ""));
}

// Prévia de mensagem do atendente (expira em 15 minutos)
export async function savePreview(user, text) {
  await redis.set(`preview:${user}`, text, "EX", 60 * 15);
}

export async function getPreview(user) {
  return await redis.get(`preview:${user}`);
}

export async function clearPreview(user) {
  await redis.del(`preview:${user}`);
}
