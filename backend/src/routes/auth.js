const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const prisma = require('../prisma');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 дней

// ================================
// ХЕЛПЕРЫ ВЫДАЧИ ТОКЕНОВ
// ================================
function issueAccessToken(user) {
  return jwt.sign(
    { userId: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );
}

async function issueRefreshToken(userId) {
  const raw = crypto.randomBytes(40).toString('hex');
  const hash = await bcrypt.hash(raw, 10);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
  await prisma.user.update({
    where: { id: userId },
    data: { refreshToken: hash, refreshTokenExpiresAt: expiresAt }
  });
  return raw;
}

// ================================
// РЕГИСТРАЦИЯ
// ================================
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Заполните все поля: имя, email, пароль' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Пароль должен быть не менее 6 символов' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
    }

    const existingName = await prisma.user.findFirst({ where: { name } });
    if (existingName) {
      return res.status(400).json({ error: 'Пользователь с таким именем уже существует' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: { name, email, password: hashedPassword }
    });

    const accessToken = issueAccessToken(user);
    const refreshToken = await issueRefreshToken(user.id);

    res.status(201).json({
      message: 'Регистрация успешна!',
      accessToken,
      refreshToken,
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
      return res.status(400).json({ error: 'Введите логин и пароль' });
    }

    // Ищем по email ИЛИ по имени
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await prisma.user.findFirst({ where: { name: email } });
    }

    if (!user) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    const accessToken = issueAccessToken(user);
    const refreshToken = await issueRefreshToken(user.id);

    res.json({
      message: 'Вход выполнен успешно!',
      accessToken,
      refreshToken,
      user: { id: user.id, name: user.name, email: user.email }
    });

  } catch (error) {
    console.error('Ошибка входа:', error);
    res.status(500).json({ error: 'Ошибка сервера при входе' });
  }
});

// ================================
// ОБНОВЛЕНИЕ ТОКЕНА
// bcrypt-хэш не позволяет искать по индексу — фильтруем по активным сессиям
// и сравниваем по очереди. Линейно от числа залогиненных пользователей.
// ================================
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body || {};
    if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    const candidates = await prisma.user.findMany({
      where: {
        refreshToken: { not: null },
        refreshTokenExpiresAt: { gt: new Date() }
      }
    });

    let matched = null;
    for (const candidate of candidates) {
      if (await bcrypt.compare(refreshToken, candidate.refreshToken)) {
        matched = candidate;
        break;
      }
    }

    if (!matched) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    const newAccessToken = issueAccessToken(matched);
    const newRefreshToken = await issueRefreshToken(matched.id);

    res.json({ accessToken: newAccessToken, refreshToken: newRefreshToken });
  } catch (error) {
    console.error('Ошибка refresh:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ================================
// ВЫХОД — обнуляем refresh-токен в БД
// ================================
router.post('/logout', authMiddleware, async (req, res) => {
  try {
    await prisma.user.update({
      where: { id: req.user.userId },
      data: { refreshToken: null, refreshTokenExpiresAt: null }
    });
    res.json({ message: 'Logged out' });
  } catch (error) {
    console.error('Ошибка logout:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ================================
// ПОЛУЧИТЬ ДАННЫЕ О СЕБЕ
// ================================
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { id: true, name: true, email: true, createdAt: true }
    });

    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ================================
// УДАЛЕНИЕ АККАУНТА
// ================================
router.delete('/account', authMiddleware, async (req, res) => {
  try {
    await prisma.user.delete({ where: { id: req.user.userId } });
    res.json({ message: 'Аккаунт удалён' });
  } catch (error) {
    console.error('Ошибка удаления аккаунта:', error);
    res.status(500).json({ error: 'Ошибка удаления аккаунта' });
  }
});

module.exports = router;
