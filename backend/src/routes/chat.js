// Маршруты для чата с ИИ
// POST /api/chat/session          — создать новую сессию
// GET  /api/chat/sessions         — получить все сессии пользователя
// GET  /api/chat/session/:id      — получить сессию с сообщениями
// POST /api/chat/session/:id/message — отправить сообщение
// DELETE /api/chat/session/:id    — удалить сессию

const express = require('express');
const { PrismaClient } = require('@prisma/client');
const authMiddleware = require('../middleware/auth');
const { sendMessage, validateMessage, compressContext, extractResumeFromResponse } = require('../services/ai');

const router = express.Router();
const prisma = new PrismaClient();

// Все маршруты чата требуют авторизации
router.use(authMiddleware);

// ================================
// СОЗДАТЬ НОВУЮ СЕССИЮ
// ================================
router.post('/session/:id/message', async (req, res) => {
  try {
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Сообщение не может быть пустым' });
    }

    // Валидация сообщения ДО обращения к ИИ
    const validation = validateMessage(content.trim());
    if (!validation.valid) {
      // Сохраняем оба сообщения в БД но не идём в ИИ
      await prisma.chatMessage.create({
        data: { sessionId: req.params.id, role: 'user', content: content.trim() }
      });
      await prisma.chatMessage.create({
        data: { sessionId: req.params.id, role: 'assistant', content: validation.response }
      });
      return res.json({ message: validation.response, resume: null });
    }

    const session = await prisma.chatSession.findFirst({
      where: { id: req.params.id, userId: req.user.userId },
      include: { messages: { orderBy: { createdAt: 'asc' } } }
    });

    if (!session) {
      return res.status(404).json({ error: 'Сессия не найдена' });
    }

    await prisma.chatMessage.create({
      data: { sessionId: session.id, role: 'user', content: content.trim() }
    });

    const messageHistory = [
      ...session.messages.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: content.trim() }
    ];

    // Отправляем в ИИ с контекстом
    const aiResponse = await sendMessage(messageHistory, session.contextSummary);

    await prisma.chatMessage.create({
      data: { sessionId: session.id, role: 'assistant', content: aiResponse }
    });

    // Сжимаем контекст если сообщений накопилось много
    let newContextSummary = session.contextSummary;
    if (messageHistory.length >= 6) {
      newContextSummary = await compressContext(messageHistory, session.contextSummary);

      if (newContextSummary) {
        // Удаляем старые сообщения, оставляем только последние 4
        const allMessages = await prisma.chatMessage.findMany({
          where: { sessionId: session.id },
          orderBy: { createdAt: 'asc' }
        });

        if (allMessages.length > 4) {
          const toDelete = allMessages.slice(0, allMessages.length - 4);
          await prisma.chatMessage.deleteMany({
            where: { id: { in: toDelete.map(m => m.id) } }
          });
        }

        // Сохраняем сжатый контекст
        await prisma.chatSession.update({
          where: { id: session.id },
          data: { contextSummary: newContextSummary }
        });
      }
    }

    // Проверяем — есть ли готовое резюме в ответе
    const resumeData = extractResumeFromResponse(aiResponse);
    let savedResume = null;

    if (resumeData?.resume && resumeData?.analysis) {
      const existing = await prisma.resume.findUnique({ where: { sessionId: session.id } });

      const resumePayload = {
        targetPosition: resumeData.resume.targetPosition,
        currentSalary: `${resumeData.analysis.currentSalaryMin}–${resumeData.analysis.currentSalaryMax} ₽`,
        futureSalary: `${resumeData.analysis.futureSalaryMin}–${resumeData.analysis.futureSalaryMax} ₽`,
        content: JSON.stringify(resumeData)
      };

      savedResume = existing
        ? await prisma.resume.update({ where: { sessionId: session.id }, data: resumePayload })
        : await prisma.resume.create({
            data: { userId: req.user.userId, sessionId: session.id, ...resumePayload }
          });
    }

    res.json({ message: aiResponse, resume: savedResume });

  } catch (error) {
    console.error('Ошибка отправки сообщения:', error);
    res.status(500).json({ error: 'Ошибка при обращении к ИИ' });
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