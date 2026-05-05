// Главный файл сервера
// Здесь мы запускаем Express и подключаем все части

require('dotenv').config(); // загружаем переменные из .env файла
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

// Подключаем наши роуты (маршруты)
const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const resumeRoutes = require('./routes/resume');
const jobsRoutes = require('./routes/jobs');
const prisma = require('./prisma');

const app = express();
const PORT = process.env.PORT || 3001;

// ============================================
// MIDDLEWARE (обработчики запросов)
// ============================================

app.set('trust proxy', 1);
// Разрешаем запросы с фронтенда (React работает на другом порту)
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

// Говорим серверу, что будем работать с JSON
app.use(express.json());

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

// ============================================
// МАРШРУТЫ (Routes)
// ============================================
app.use('/api/auth', authRoutes);     // /api/auth/register, /api/auth/login
app.use('/api/chat', chatRoutes);     // /api/chat/session, /api/chat/message
app.use('/api/resume', resumeRoutes); // /api/resume/:id, /api/resume/:id/pdf
app.use('/api/jobs', jobsRoutes);     // /api/jobs/salary, /api/jobs/vacancies, /api/jobs/skills

// Проверочный маршрут — можно открыть в браузере
app.get('/api/health', async (req, res) => {
  const dbOk = await prisma.$queryRaw`SELECT 1`
    .then(() => true)
    .catch(() => false);

  res.json({
    status: dbOk ? 'OK' : 'DEGRADED',
    message: 'CarIP Backend',
    database: dbOk ? 'connected' : 'error',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Обработка ошибок
app.use((err, req, res, next) => {
  console.error('Ошибка сервера:', err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

// Запускаем сервер
app.listen(PORT, () => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
  console.log(`🌐 Проверь: http://localhost:${PORT}/api/health`);
});
