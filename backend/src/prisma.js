const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  log: ['error'],
});

const originalRequest = prisma._request.bind(prisma);

prisma.$use(async (params, next) => {
  try {
    return await next(params);
  } catch (err) {
    if (err.code === 'P1017' || err.message?.includes('Server has closed the connection')) {
      console.log('DB disconnected, reconnecting...');
      await prisma.$disconnect();
      await new Promise(r => setTimeout(r, 500));
      await prisma.$connect();
      return await next(params);
    }
    throw err;
  }
});

module.exports = prisma;
