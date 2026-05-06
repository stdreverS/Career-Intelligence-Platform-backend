const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  log: ['error'],
});

const originalRequest = prisma._request.bind(prisma);

prisma.$use(async (params, next) => {
  try {
    return await next(params);
  } catch (err) {
    if (err.code) {
      console.error(`[PRISMA] ${err.code} on ${params.model}.${params.action}: ${err.message.split('\n')[0]}`);
    }
    if (err.code === 'P1017' || err.message?.includes('Server has closed the connection')) {
      console.error('[PRISMA] Connection lost, attempting reconnect...');
      await prisma.$disconnect();
      await new Promise(r => setTimeout(r, 500));
      await prisma.$connect();
      console.error('[PRISMA] Reconnected successfully');
      return await next(params);
    }
    throw err;
  }
});

const KEEPALIVE_INTERVAL_MS = 5 * 60 * 1000;

setInterval(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('[DB] Keepalive ping OK');
  } catch (err) {
    console.error('[DB] Keepalive ping failed:', err.message);
    try {
      await prisma.$disconnect();
      await prisma.$connect();
      console.log('[DB] Reconnected after keepalive failure');
    } catch (reconnectErr) {
      console.error('[DB] Reconnect failed:', reconnectErr.message);
    }
  }
}, KEEPALIVE_INTERVAL_MS).unref();

module.exports = prisma;
