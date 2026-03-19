// Маршруты для работы с резюме
// GET /api/resume/my          — все резюме пользователя
// GET /api/resume/:id         — конкретное резюме
// GET /api/resume/:id/pdf     — скачать PDF

const express = require('express');
const { PrismaClient } = require('@prisma/client');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

router.use(authMiddleware);

// ================================
// ВСЕ РЕЗЮМЕ ПОЛЬЗОВАТЕЛЯ
// ================================
router.get('/my', async (req, res) => {
  try {
    const resumes = await prisma.resume.findMany({
      where: { userId: req.user.userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        targetPosition: true,
        currentSalary: true,
        futureSalary: true,
        createdAt: true
      }
    });

    res.json({ resumes });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка получения резюме' });
  }
});

// ================================
// ПОЛУЧИТЬ КОНКРЕТНОЕ РЕЗЮМЕ
// ================================
router.get('/:id', async (req, res) => {
  try {
    const resume = await prisma.resume.findFirst({
      where: { id: req.params.id, userId: req.user.userId }
    });

    if (!resume) {
      return res.status(404).json({ error: 'Резюме не найдено' });
    }

    res.json({
      resume: {
        ...resume,
        content: JSON.parse(resume.content) // превращаем строку обратно в объект
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка получения резюме' });
  }
});

// ================================
// СКАЧАТЬ PDF
// Генерацию PDF делает фронтенд React (библиотека jsPDF или html2pdf)
// Бэкенд возвращает данные, фронтенд строит PDF
// ================================
router.get('/:id/data-for-pdf', async (req, res) => {
  try {
    const resume = await prisma.resume.findFirst({
      where: { id: req.params.id, userId: req.user.userId },
      include: {
        user: { select: { name: true, email: true } }
      }
    });

    if (!resume) {
      return res.status(404).json({ error: 'Резюме не найдено' });
    }

    const content = JSON.parse(resume.content);

    res.json({
      userData: { name: resume.user.name, email: resume.user.email },
      resume: content.resume,
      analysis: content.analysis,
      generatedAt: resume.createdAt
    });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка получения данных для PDF' });
  }
});

module.exports = router;