// Маршруты для чата с ИИ
// POST /api/chat/session          — создать новую сессию
// GET  /api/chat/sessions         — получить все сессии пользователя
// GET  /api/chat/session/:id      — получить сессию с сообщениями
// POST /api/chat/session/:id/message — отправить сообщение
// DELETE /api/chat/session/:id    — удалить сессию

const express = require('express');
const { PrismaClient } = require('@prisma/client');
const authMiddleware = require('../middleware/auth');
const { sendMessage, extractResumeFromResponse } = require('../services/ai');

const router = express.Router();
const prisma = new PrismaClient();

// Все маршруты чата требуют авторизации
router.use(authMiddleware);

// ================================
// СОЗДАТЬ НОВУЮ СЕССИЮ
// ================================
router.post('/session', async (req, res) => {
  try {
    const session = await prisma.chatSession.create({
      data: {
        userId: req.user.userId,
        title: 'Анализ резюме ' + new Date().toLocaleDateString('ru-RU')
      }
    });

    res.status(201).json({ session });
  } catch (error) {
    console.error('Ошибка создания сессии:', error);
    res.status(500).json({ error: 'Не удалось создать сессию' });
  }
});

// ================================
// ПОЛУЧИТЬ ВСЕ СЕССИИ ПОЛЬЗОВАТЕЛЯ
// ================================
router.get('/sessions', async (req, res) => {
  try {
    const sessions = await prisma.chatSession.findMany({
      where: { userId: req.user.userId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { messages: true } },
        resume: { select: { targetPosition: true } }
      }
    });

    res.json({ sessions });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка получения сессий' });
  }
});

// ================================
// ПОЛУЧИТЬ СЕССИЮ С СООБЩЕНИЯМИ
// ================================
router.get('/session/:id', async (req, res) => {
  try {
    const session = await prisma.chatSession.findFirst({
      where: {
        id: req.params.id,
        userId: req.user.userId // проверяем что сессия принадлежит этому пользователю
      },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        resume: true
      }
    });

    if (!session) {
      return res.status(404).json({ error: 'Сессия не найдена' });
    }

    res.json({ session });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка получения сессии' });
  }
});

// ================================
// ОТПРАВИТЬ СООБЩЕНИЕ (главный маршрут!)
// ================================
router.post('/session/:id/message', async (req, res) => {
  try {
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Сообщение не может быть пустым' });
    }

    // Проверяем что сессия принадлежит пользователю
    const session = await prisma.chatSession.findFirst({
      where: { id: req.params.id, userId: req.user.userId },
      include: { messages: { orderBy: { createdAt: 'asc' } } }
    });

    if (!session) {
      return res.status(404).json({ error: 'Сессия не найдена' });
    }

    // Сохраняем сообщение пользователя в БД
    await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: 'user',
        content: content.trim()
      }
    });

    // Формируем историю для ИИ (всё что было + новое сообщение)
    const messageHistory = [
      ...session.messages.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: content.trim() }
    ];

    // Отправляем в ИИ и получаем ответ
    const aiResponse = await sendMessage(messageHistory);

    // Сохраняем ответ ИИ в БД
    await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: 'assistant',
        content: aiResponse
      }
    });

    // Проверяем — может ИИ уже сгенерировал резюме?
    const resumeData = extractResumeFromResponse(aiResponse);
    let savedResume = null;

    if (resumeData && resumeData.resume && resumeData.analysis) {
      // Сохраняем резюме в базу данных
      const existingResume = await prisma.resume.findUnique({
        where: { sessionId: session.id }
      });

      if (existingResume) {
        savedResume = await prisma.resume.update({
          where: { sessionId: session.id },
          data: {
            targetPosition: resumeData.resume.targetPosition,
            currentSalary: `${resumeData.analysis.currentSalaryMin}–${resumeData.analysis.currentSalaryMax} ₽`,
            futureSalary: `${resumeData.analysis.futureSalaryMin}–${resumeData.analysis.futureSalaryMax} ₽`,
            content: JSON.stringify(resumeData)
          }
        });
      } else {
        savedResume = await prisma.resume.create({
          data: {
            userId: req.user.userId,
            sessionId: session.id,
            targetPosition: resumeData.resume.targetPosition,
            currentSalary: `${resumeData.analysis.currentSalaryMin}–${resumeData.analysis.currentSalaryMax} ₽`,
            futureSalary: `${resumeData.analysis.futureSalaryMin}–${resumeData.analysis.futureSalaryMax} ₽`,
            content: JSON.stringify(resumeData)
          }
        });
      }
    }

    res.json({
      message: aiResponse,
      resume: savedResume // null если резюме ещё не готово
    });

  } catch (error) {
    console.error('Ошибка отправки сообщения:', error);
    res.status(500).json({ error: 'Ошибка при обращении к ИИ' });
  }
});

// ================================
// УДАЛИТЬ СЕССИЮ
// ================================
router.delete('/session/:id', async (req, res) => {
  try {
    const session = await prisma.chatSession.findFirst({
      where: { id: req.params.id, userId: req.user.userId }
    });

    if (!session) {
      return res.status(404).json({ error: 'Сессия не найдена' });
    }

    await prisma.chatSession.delete({ where: { id: req.params.id } });
    res.json({ message: 'Сессия удалена' });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка удаления сессии' });
  }
});

module.exports = router;