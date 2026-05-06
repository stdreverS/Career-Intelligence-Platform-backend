// Gap-анализ: что у пользователя есть, чего не хватает до целевой роли,
// какие курсы пройти, сколько это займёт по времени.

const express = require('express');
const prisma = require('../prisma');
const authMiddleware = require('../middleware/auth');
const { groq } = require('../services/ai');

const router = express.Router();

router.use(authMiddleware);

// ============================================
// КЭШ — экономим квоту Groq, 30 минут на резюме
// ============================================
const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = {};

function getCached(resumeId) {
  const item = cache[resumeId];
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    delete cache[resumeId];
    return null;
  }
  return item.data;
}

function setCached(resumeId, data) {
  cache[resumeId] = { data, expiresAt: Date.now() + CACHE_TTL_MS };
}

// ============================================
// СИСТЕМНЫЙ ПРОМПТ ДЛЯ GAP-АНАЛИЗА
// ============================================
const GAP_SYSTEM_PROMPT = `Ты — карьерный аналитик. Анализируешь разрыв между текущими навыками человека и требованиями целевой позиции на российском рынке IT.

КРИТИЧЕСКИ ВАЖНО:
- Отвечай ТОЛЬКО валидным JSON. Без markdown, без \`\`\`, без преамбулы, без комментариев.
- Не оборачивай ответ ни в какие теги.
- Все строковые значения — на русском языке (кроме названий технологий).

Структура ответа (строго эта):
{
  "missingSkills": [
    { "skill": "string", "priority": "high" | "medium" | "low", "reason": "string на русском, со статистикой по рынку" }
  ],
  "recommendedCourses": [
    { "skill": "string", "platform": "string", "title": "string", "url": "string", "durationWeeks": number }
  ],
  "estimatedTimeMonths": number,
  "readinessPercent": number,
  "summary": "string на русском, 1-2 предложения"
}

Правила содержания:
- missingSkills: максимум 6 элементов, отсортированы по убыванию приоритета (high → low).
- priority строго одно из: "high", "medium", "low".
- reason обязательно содержит процент или статистику ("Требуется в 87% вакансий ...").
- recommendedCourses: ровно по одному курсу на каждый missingSkill с приоритетом high или medium (low пропускай).
- Площадки в порядке предпочтения: Stepik и Яндекс Практикум для русскоязычного контента, Coursera для англоязычного. Бери из этих трёх.
- url должен быть похож на реальный URL площадки (https://stepik.org/..., https://practicum.yandex.ru/..., https://www.coursera.org/...).
- estimatedTimeMonths: целое число месяцев, реалистично с учётом перечисленных курсов.
- readinessPercent: целое 0-100, отражает долю требований, которые человек уже закрывает.
- summary: краткий итог на русском, без воды.`;

// ============================================
// GET /api/analysis/:id/gap-report
// (монтируется как /api/analysis в index.js)
// ============================================
router.get('/:id/gap-report', async (req, res) => {
  try {
    const resumeId = req.params.id;
    const refresh = req.query.refresh === 'true';

    const resume = await prisma.resume.findFirst({
      where: { id: resumeId }
    });

    if (!resume) {
      return res.status(404).json({ error: 'Резюме не найдено' });
    }

    if (resume.userId !== req.user.userId) {
      return res.status(403).json({ error: 'Нет доступа к этому резюме' });
    }

    // Парсим content и достаём навыки/позицию/опыт
    let content;
    try {
      content = JSON.parse(resume.content);
    } catch {
      return res.status(400).json({ error: 'Resume is incomplete, finish the chat session first' });
    }

    const currentSkills = content?.resume?.skills?.hard;
    const targetPosition = content?.resume?.targetPosition || resume.targetPosition;
    const experience = content?.resume?.experience;

    if (!Array.isArray(currentSkills) || currentSkills.length === 0 || !targetPosition) {
      return res.status(400).json({ error: 'Resume is incomplete, finish the chat session first' });
    }

    // Кэш
    if (!refresh) {
      const cached = getCached(resumeId);
      if (cached) return res.json(cached);
    }

    // Готовим контекст для Groq
    const userContext = JSON.stringify({
      currentSkills,
      targetPosition,
      experience: experience || []
    });

    let parsed;
    try {
      const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: GAP_SYSTEM_PROMPT },
          { role: 'user', content: `Данные пользователя (JSON):\n${userContext}\n\nВыполни gap-анализ и верни строго JSON по описанной схеме.` }
        ],
        temperature: 0.2,
        max_tokens: 1500,
        response_format: { type: 'json_object' }
      });

      const raw = completion.choices[0].message.content;
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error('Gap analysis Groq/JSON error:', err);
      return res.status(500).json({ error: 'Analysis generation failed, please try again' });
    }

    const result = {
      resumeId: resume.id,
      targetPosition,
      analysisDate: new Date().toISOString(),
      currentSkills,
      missingSkills: Array.isArray(parsed.missingSkills) ? parsed.missingSkills.slice(0, 6) : [],
      recommendedCourses: Array.isArray(parsed.recommendedCourses) ? parsed.recommendedCourses : [],
      estimatedTimeMonths: typeof parsed.estimatedTimeMonths === 'number' ? parsed.estimatedTimeMonths : 0,
      readinessPercent: typeof parsed.readinessPercent === 'number' ? parsed.readinessPercent : 0,
      summary: typeof parsed.summary === 'string' ? parsed.summary : ''
    };

    setCached(resumeId, result);
    res.json(result);
  } catch (error) {
    console.error('Gap report error:', error);
    res.status(500).json({ error: 'Analysis generation failed, please try again' });
  }
});

module.exports = router;
