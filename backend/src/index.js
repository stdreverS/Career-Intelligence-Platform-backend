// Главный файл сервера
// Здесь мы запускаем Express и подключаем все части

require('dotenv').config(); // загружаем переменные из .env файла
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const sanitize = require('./middleware/sanitize');

process.on('unhandledRejection', (reason, promise) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err);
  process.exit(1);
});

// Подключаем наши роуты (маршруты)
const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const resumeRoutes = require('./routes/resume');
const jobsRoutes = require('./routes/jobs');
const analysisRoutes = require('./routes/analysis');
const githubRoutes = require('./routes/github');
const prisma = require('./prisma');

const app = express();
const PORT = process.env.PORT || 3001;

// ============================================
// MIDDLEWARE (обработчики запросов)
// ============================================

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false
}));

app.set('trust proxy', 1);
// Разрешаем запросы с фронтенда (React работает на другом порту)
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

// Говорим серверу, что будем работать с JSON
app.use(express.json());
app.use(sanitize);

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? 'ERROR' :
                  res.statusCode >= 400 ? 'WARN' : 'INFO';
    console.log(`[${new Date().toISOString()}] ${level} ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  next();
});

app.use((req, res, next) => {
  const timeout = 30000;
  const timer = setTimeout(() => {
    if (!res.headersSent) {
      console.error(`[TIMEOUT] ${req.method} ${req.originalUrl} exceeded ${timeout}ms`);
      res.status(503).json({ error: 'Request timeout, please try again' });
    }
  }, timeout);

  res.on('finish', () => clearTimeout(timer));
  res.on('close', () => clearTimeout(timer));

  next();
});

// Общий лимит — 100 запросов за 15 минут
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Слишком много запросов, подождите немного' }
});
app.use('/api/', limiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Слишком много попыток входа. Подождите 15 минут.' }
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

const analysisLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many analysis requests, please wait 15 minutes' }
});

const githubLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { error: 'Too many GitHub requests, please wait 15 minutes' }
});

app.use('/api/analysis', analysisLimiter);
app.use('/api/github', githubLimiter);

// ============================================
// МАРШРУТЫ (Routes)
// ============================================
app.use('/api/auth', authRoutes);     // /api/auth/register, /api/auth/login
app.use('/api/chat', chatRoutes);     // /api/chat/session, /api/chat/message
app.use('/api/resume', resumeRoutes); // /api/resume/:id, /api/resume/:id/pdf
app.use('/api/jobs', jobsRoutes);     // /api/jobs/salary, /api/jobs/vacancies, /api/jobs/skills
app.use('/api/analysis', analysisRoutes); // /api/analysis/:id/gap-report
app.use('/api/github', githubRoutes);     // /api/github/analyze

// Проверочный маршрут — можно открыть в браузере
app.get('/api/health', async (req, res) => {
  const dbOk = await prisma.$queryRaw`SELECT 1`
    .then(() => true)
    .catch(() => false);

  let groqOk = false;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
        signal: controller.signal
      });
      groqOk = response.ok;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    groqOk = false;
  }

  res.json({
    status: dbOk && groqOk ? 'OK' : 'DEGRADED',
    database: dbOk ? 'connected' : 'error',
    groq: groqOk ? 'connected' : 'error',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: `Route ${req.method} ${req.originalUrl} not found` });
  }
  next();
});

app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';
  console.error(`[ERROR] ${req.method} ${req.path} ${status}: ${message}`);
  res.status(status).json({ error: message });
});

// Запускаем сервер
  app.listen(PORT, '0.0.0.0',() => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
  console.log(`🌐 Проверь: http://localhost:${PORT}/api/health`);
  console.log('Cache: in-memory (resets on restart)');
});
