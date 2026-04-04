// Маршруты для авторизации
// POST /api/auth/register — регистрация
// POST /api/auth/login    — вход
// GET  /api/auth/me       — получить данные о себе

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// ================================
// РЕГИСТРАЦИЯ
// ================================
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Проверяем что все поля заполнены
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Заполните все поля: имя, email, пароль' });
    }

    // Проверяем что такого email ещё нет
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
    }

    // Шифруем пароль (никогда не храним пароли в открытом виде!)
    // 10 — это "сложность" шифрования, стандартное значение
    const hashedPassword = await bcrypt.hash(password, 10);

    // Создаём пользователя в базе данных
    const user = await prisma.user.create({
      data: { name, email, password: hashedPassword }
    });

    // Создаём JWT токен — это "пропуск" пользователя
    const token = jwt.sign(
      { userId: user.id, email: user.email }, // что кладём в токен
      process.env.JWT_SECRET,                  // секретный ключ
      { expiresIn: '7d' }                      // токен живёт 7 дней
    );

    res.status(201).json({
      message: 'Регистрация успешна!',
      token,
      user: { id: user.id, name: user.name, email: user.email }
    });

  } catch (error) {
    console.error('Ошибка регистрации:', error);
    res.status(500).json({ error: 'Ошибка сервера при регистрации' });
  }
});

// ================================
// ВХОД
// ================================
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Введите email и пароль' });
    }

    // Ищем пользователя по email
    // Ищем пользователя по email ИЛИ по имени (name)
    let user = await prisma.user.findUnique({ where: { email } });

    // Если не нашли по email — ищем по имени пользователя
    if (!user) {
      user = await prisma.user.findFirst({ where: { name: email } });
    }

    if (!user) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    // Сравниваем введённый пароль с зашифрованным
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }

    // Выдаём новый токен
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Вход выполнен успешно!',
      token,
      user: { id: user.id, name: user.name, email: user.email }
    });

  } catch (error) {
    console.error('Ошибка входа:', error);
    res.status(500).json({ error: 'Ошибка сервера при входе' });
  }
});

// ================================
// ПОЛУЧИТЬ ДАННЫЕ О СЕБЕ
// ================================
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { id: true, name: true, email: true, createdAt: true } // не возвращаем пароль!
    });

    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;