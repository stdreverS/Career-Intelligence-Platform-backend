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

const app = express();
const PORT = process.env.PORT || 3001;

// ============================================
// MIDDLEWARE (обработчики запросов)
// ============================================

// Разрешаем запросы с фронтенда (React работает на другом порту)
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

// Говорим серверу, что будем работать с JSON
app.use(express.json());

// Защита от спама — не более 100 запросов за 15 минут с одного IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Слишком много запросов, подождите немного' }
});
app.use('/api/', limiter);

// ============================================
// МАРШРУТЫ (Routes)
// ============================================
app.use('/api/auth', authRoutes);     // /api/auth/register, /api/auth/login
app.use('/api/chat', chatRoutes);     // /api/chat/session, /api/chat/message
app.use('/api/resume', resumeRoutes); // /api/resume/:id, /api/resume/:id/pdf

// Проверочный маршрут — можно открыть в браузере
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Сервер Resume AI работает!',
    timestamp: new Date().toISOString()
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