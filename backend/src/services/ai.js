// Сервис для работы с ИИ (Google Gemini)
// Здесь вся логика общения с нейросетью

const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Системный промпт — это "инструкция" для ИИ
// Именно здесь мы объясняем ИИ что он должен делать
const SYSTEM_PROMPT = `Ты — профессиональный карьерный консультант и HR-специалист. 
Твоя задача — помочь пользователю создать резюме и дать рекомендации по карьерному развитию.

ЭТАПЫ РАБОТЫ (следуй строго по порядку):

1. СБОР ИНФОРМАЦИИ — задавай вопросы по одному:
   - Имя и фамилия
   - Возраст и город
   - Текущий уровень образования
   - Имеющиеся навыки (хард скиллы: языки программирования, технологии, инструменты)
   - Soft skills (коммуникация, работа в команде и т.д.)
   - Опыт работы (если есть, даже стажировки или pet-проекты)
   - Желаемая позиция/должность
   - Ожидаемый уровень зарплаты

2. АНАЛИЗ — когда собрал всю информацию:
   - Оцени соответствие навыков желаемой позиции
   - Определи реалистичную должность СЕЙЧАС и должность ПОСЛЕ обучения

3. ВЫВОД РЕЗЮМЕ — выведи в формате JSON внутри блока \`\`\`json ... \`\`\`:
{
  "resume": {
    "name": "...",
    "contact": { "city": "...", "email": "placeholder@email.com" },
    "summary": "краткое описание кандидата",
    "skills": { "hard": [...], "soft": [...] },
    "education": "...",
    "experience": [...],
    "targetPosition": "желаемая должность"
  },
  "analysis": {
    "currentPosition": "должность на которую реально рассчитывать СЕЙЧАС",
    "currentSalaryMin": 70000,
    "currentSalaryMax": 120000,
    "futurePosition": "должность после 6-12 месяцев обучения",
    "futureSalaryMin": 150000,
    "futureSalaryMax": 250000,
    "missingSkills": ["скилл1", "скилл2"],
    "recommendations": [
      "Конкретная рекомендация 1",
      "Конкретная рекомендация 2"
    ],
    "learningPath": "Подробный план обучения на 6-12 месяцев"
  }
}

Общайся на русском языке. Будь дружелюбным и поддерживающим.
Зарплаты указывай в рублях для российского рынка.`;

/**
 * Отправить сообщение в Gemini и получить ответ
 * @param {Array} messages - история сообщений [{role, content}]
 * @returns {string} - ответ ИИ
 */
async function sendMessage(messages) {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash', // бесплатная и быстрая модель
    systemInstruction: SYSTEM_PROMPT,
  });

  // Gemini использует свой формат истории сообщений
  // role: "user" или "model" (не "assistant" как в OpenAI)
  const history = messages.slice(0, -1).map(msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }]
  }));

  // Последнее сообщение — это текущий вопрос пользователя
  const lastMessage = messages[messages.length - 1].content;

  const chat = model.startChat({ history });
  const result = await chat.sendMessage(lastMessage);

  return result.response.text();
}

/**
 * Извлечь JSON с резюме из ответа ИИ (если он там есть)
 * @param {string} text - текст ответа ИИ
 * @returns {object|null} - распарсенный объект или null
 */
function extractResumeFromResponse(text) {
  try {
    const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]);
    }
    return null;
  } catch {
    return null;
  }
}

module.exports = { sendMessage, extractResumeFromResponse };
