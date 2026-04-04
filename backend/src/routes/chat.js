const express = require('express');
const { PrismaClient } = require('@prisma/client');
const authMiddleware = require('../middleware/auth');
const {
  sendMessage,
  validateMessage,
  compressContext,
  extractResumeFromResponse
} = require('../services/ai');

const router = express.Router();
const prisma = new PrismaClient();

router.use(authMiddleware);

// ============================================
// ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ СЖАТИЯ
// Вызывается при всех "безопасных" действиях
// ============================================
async function compressAndCleanSession(sessionId) {
  try {
    const session = await prisma.chatSession.findUnique({
      where: { id: sessionId },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        resume: true
      }
    });

    if (!session || session.messages.length === 0) return;

    // Получаем текстовое резюме если оно есть
    let resumeText = null;
    if (session.resume) {
      const content = JSON.parse(session.resume.content);
      resumeText = content.resume
        ? `Имя: ${content.resume.name}, Позиция: ${content.resume.targetPosition}, Навыки: ${content.resume.skills?.hard?.join(', ')}`
        : null;
    }

    // Сжимаем контекст
    const newSummary = await compressContext(session.messages, resumeText);
    if (!newSummary) return;

    // Удаляем ВСЕ сообщения — контекст сохранён в summary
    await prisma.chatMessage.deleteMany({
      where: { sessionId }
    });

    // Сохраняем сжатый контекст
    await prisma.chatSession.update({
      where: { id: sessionId },
      data: { contextSummary: newSummary }
    });
  } catch (error) {
    console.error('Ошибка сжатия контекста:', error);
  }
}

// ============================================
// СОЗДАТЬ НОВУЮ СЕССИЮ
// При создании нового чата — сжимаем предыдущий открытый
// ============================================
router.post('/session', async (req, res) => {
  try {
    const { previousSessionId } = req.body;

    // Если передан ID предыдущей сессии — сжимаем её
    if (previousSessionId) {
      await compressAndCleanSession(previousSessionId);
    }

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

// ============================================
// ПОЛУЧИТЬ ВСЕ СЕССИИ
// При открытии списка — сжимаем текущую открытую сессию
// ============================================
router.get('/sessions', async (req, res) => {
  try {
    const { currentSessionId } = req.query;

    // Сжимаем текущую открытую сессию если передана
    if (currentSessionId) {
      await compressAndCleanSession(currentSessionId);
    }

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

// ============================================
// ПОЛУЧИТЬ КОНКРЕТНУЮ СЕССИЮ
// ============================================
router.get('/session/:id', async (req, res) => {
  try {
    const session = await prisma.chatSession.findFirst({
      where: { id: req.params.id, userId: req.user.userId },
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

// ============================================
// ОТПРАВИТЬ СООБЩЕНИЕ
// ============================================
router.post('/session/:id/message', async (req, res) => {
  try {
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Сообщение не может быть пустым' });
    }

    // Уровень 1 — валидация на инъекции и офтопик
    const validation = validateMessage(content.trim());
    if (!validation.valid) {
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
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        resume: true
      }
    });

    if (!session) {
      return res.status(404).json({ error: 'Сессия не найдена' });
    }

    // Уровень 2 — если резюме готово, разрешаем только корректировку
    if (session.resume) {
      const allowedAfterResume = [
        /более? (формальн|дружелюбн|официальн|мягк|строг)/i,
        /измени (стиль|тон|формат)/i,
        /сделай (более|менее)/i,
        /перепиши/i,
        /скачать|сохранить|pdf/i,
        /спасибо|отлично|хорошо|нравится|устраивает|супер|класс/i,
        /нет|да|ок|окей|хочу изменить/i,
        /поменяй|исправь|измени/i,
      ];

      const isAllowed = allowedAfterResume.some(p => p.test(content.trim()));

      if (!isAllowed) {
        const blockResponse = 'Резюме уже сформировано! Я могу скорректировать его стиль или тон. Например: "сделай более формальным" или "перепиши мягче". Также можете скачать резюме в PDF.';
        await prisma.chatMessage.create({
          data: { sessionId: req.params.id, role: 'user', content: content.trim() }
        });
        await prisma.chatMessage.create({
          data: { sessionId: req.params.id, role: 'assistant', content: blockResponse }
        });
        return res.json({ message: blockResponse, resume: null });
      }
    }

    // Сохраняем сообщение пользователя
    await prisma.chatMessage.create({
      data: { sessionId: session.id, role: 'user', content: content.trim() }
    });

    // Формируем историю для ИИ
    const messageHistory = [
      ...session.messages.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: content.trim() }
    ];

    // Отправляем в ИИ с контекстом
    const aiResponse = await sendMessage(messageHistory, session.contextSummary);

    // Сохраняем ответ ИИ
    await prisma.chatMessage.create({
      data: { sessionId: session.id, role: 'assistant', content: aiResponse }
    });

    // Проверяем — сгенерировало ли ИИ резюме
    const resumeData = extractResumeFromResponse(aiResponse);
    let savedResume = null;

    if (resumeData?.resume && resumeData?.analysis) {
      const resumePayload = {
        targetPosition: resumeData.resume.targetPosition,
        currentSalary: `${resumeData.analysis.currentSalaryMin}–${resumeData.analysis.currentSalaryMax} ₽`,
        futureSalary: `${resumeData.analysis.futureSalaryMin}–${resumeData.analysis.futureSalaryMax} ₽`,
        content: JSON.stringify(resumeData)
      };

      const existing = await prisma.resume.findUnique({
        where: { sessionId: session.id }
      });

      savedResume = existing
        ? await prisma.resume.update({
            where: { sessionId: session.id },
            data: resumePayload
          })
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

// ============================================
// УДАЛИТЬ СЕССИЮ
// При удалении — сжимаем текущую открытую если она другая
// ============================================
router.delete('/session/:id', async (req, res) => {
  try {
    const { currentSessionId } = req.query;

    // Если удаляем не текущую сессию — сжимаем текущую
    if (currentSessionId && currentSessionId !== req.params.id) {
      await compressAndCleanSession(currentSessionId);
    }

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