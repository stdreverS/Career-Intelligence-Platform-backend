const express = require('express');
const prisma = require('../prisma');
const authMiddleware = require('../middleware/auth');
const validateUUID = require('../middleware/validateUUID');
const {
  sendMessage,
  validateMessage,
  compressContext,
  extractResumeFromResponse
} = require('../services/ai');
const { getSalaryStats } = require('../services/salaryService');

function validateResumeContent(content) {
  if (!content || typeof content !== 'object') return false;
  if (!content.resume) return false;
  if (!content.resume.name || typeof content.resume.name !== 'string') return false;
  if (!content.resume.targetPosition || typeof content.resume.targetPosition !== 'string') return false;
  if (!content.resume.skills) return false;
  if (!Array.isArray(content.resume.skills.hard)) return false;
  return true;
}

function sanitizeAIResponse(text) {
  return text
    .replace(/[■□▪▫▲△◆◇⬛⬜⭐★☆]/g, '')
    .replace(/[^\x09\x0A\x0D\x20-\x7E -ɏЀ-ӿ‐-‧‰-⁞⁠-⿿　-퟿]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const router = express.Router();

router.use(authMiddleware);

// ============================================
// ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ СЖАТИЯ
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

    let resumeText = null;
    if (session.resume) {
      const content = JSON.parse(session.resume.content);
      resumeText = content.resume
        ? `Имя: ${content.resume.name}, Позиция: ${content.resume.targetPosition}, Навыки: ${content.resume.skills?.hard?.join(', ')}`
        : null;
    }

    const newSummary = await compressContext(session.messages, resumeText);
    if (!newSummary) return;

    await prisma.chatMessage.deleteMany({ where: { sessionId } });

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
// ============================================
router.post('/session', async (req, res) => {
  try {
    const { previousSessionId } = req.body;

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
// ============================================
router.get('/sessions', async (req, res) => {
  try {
    const { currentSessionId } = req.query;

    if (currentSessionId) {
      await compressAndCleanSession(currentSessionId);
    }

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    if (req.query.limit && parseInt(req.query.limit) > 50) {
      return res.status(400).json({ error: 'limit must be <= 50' });
    }
    if (req.query.page && parseInt(req.query.page) < 1) {
      return res.status(400).json({ error: 'page must be >= 1' });
    }

    const [sessions, total] = await Promise.all([
      prisma.chatSession.findMany({
        where: { userId: req.user.userId },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
        include: {
          resume: {
            select: {
              id: true,
              targetPosition: true,
              currentSalary: true,
              futureSalary: true
            }
          }
        }
      }),
      prisma.chatSession.count({
        where: { userId: req.user.userId }
      })
    ]);

    return res.json({
      data: sessions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка получения сессий' });
  }
});

// ============================================
// ПОЛУЧИТЬ КОНКРЕТНУЮ СЕССИЮ
// ============================================
router.get('/session/:id', validateUUID('id'), async (req, res) => {
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
router.post('/session/:id/message', validateUUID('id'), async (req, res) => {
  try {
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Сообщение не может быть пустым' });
    }

    // Сначала проверяем что сессия существует
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

    // Уровень 1 — валидация на инъекции и офтопик
    const validation = validateMessage(content.trim());
    if (!validation.valid) {
      await prisma.chatMessage.create({
        data: { sessionId: session.id, role: 'user', content: content.trim() }
      });
      await prisma.chatMessage.create({
        data: { sessionId: session.id, role: 'assistant', content: validation.response }
      });
      return res.json({ message: validation.response, resume: null });
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
          data: { sessionId: session.id, role: 'user', content: content.trim() }
        });
        await prisma.chatMessage.create({
          data: { sessionId: session.id, role: 'assistant', content: blockResponse }
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

    // Если данных в диалоге накопилось достаточно — обогащаем контекст реальными
    // зарплатами (JSearch API + статический fallback), чтобы ИИ оперировал рынком
    const positionKeywords = [
      'разработчик', 'менеджер', 'дизайнер', 'аналитик',
      'инженер', 'developer', 'manager', 'designer'
    ];
    const recentText = messageHistory.slice(-6).map(m => m.content).join(' ').toLowerCase();
    const hasPosition = positionKeywords.some(k => recentText.includes(k));

    let salaryContext = '';
    if (hasPosition && messageHistory.length >= 8) {
      const lastMessages = messageHistory.slice(-6).map(m => m.content).join(' ');
      try {
        const stats = await getSalaryStats(lastMessages.slice(0, 100));
        if (stats) {
          const source = stats.source === 'jsearch' ? 'JSearch API' : 'данным рынка труда';
          salaryContext = `\n\n[РЕАЛЬНЫЕ ДАННЫЕ]: По ${source} средние зарплаты для "${stats.query}": от ${stats.min.toLocaleString()} до ${stats.max.toLocaleString()} руб. Используй именно эти цифры в анализе.`;
        }
      } catch {
        // молча игнорируем — ИИ обойдётся своими оценками
      }
    }

    const enrichedMessages = [...messageHistory];
    if (salaryContext) {
      enrichedMessages[enrichedMessages.length - 1] = {
        ...enrichedMessages[enrichedMessages.length - 1],
        content: enrichedMessages[enrichedMessages.length - 1].content + salaryContext
      };
    }

    // Отправляем в ИИ с контекстом
    const aiResponse = await sendMessage(enrichedMessages, session.contextSummary);
    const cleanAiResponse = sanitizeAIResponse(aiResponse);

    // Сохраняем ответ ИИ
    await prisma.chatMessage.create({
      data: { sessionId: session.id, role: 'assistant', content: cleanAiResponse }
    });

    // Проверяем — сгенерировало ли ИИ резюме
    const resumeData = extractResumeFromResponse(cleanAiResponse);
    let savedResume = null;

    if (resumeData?.resume && resumeData?.analysis) {
      if (!validateResumeContent(resumeData)) {
        console.error('[RESUME] Invalid content structure:', JSON.stringify(resumeData).slice(0, 200));
        return res.status(500).json({ error: 'Resume generation failed, please try again' });
      }

      const resumePayload = {
        targetPosition: resumeData.resume.targetPosition,
        currentSalary: `${resumeData.analysis.currentSalaryMin}–${resumeData.analysis.currentSalaryMax} ₽`,
        futureSalary: `${resumeData.analysis.futureSalaryMin}–${resumeData.analysis.futureSalaryMax} ₽`,
        content: sanitizeAIResponse(JSON.stringify(resumeData))
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

    res.json({ message: cleanAiResponse, resume: savedResume });

  } catch (error) {
    console.error('Ошибка отправки сообщения:', error);
    res.status(500).json({ error: 'Ошибка при обращении к ИИ' });
  }
});

// ============================================
// УДАЛИТЬ СЕССИЮ
// ============================================
router.delete('/session/:id', validateUUID('id'), async (req, res) => {
  try {
    const { currentSessionId } = req.query;

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