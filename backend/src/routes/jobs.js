// Роуты вакансий — обёртка над salaryService (JSearch API + статический fallback)
const express = require('express');
const authMiddleware = require('../middleware/auth');
const { getSalaryStats, getVacancies, getTopSkills } = require('../services/salaryService');

const router = express.Router();

router.use(authMiddleware);

// ============================================
// КЭШ — экономим лимит RapidAPI (200 запросов/день)
// ============================================
const cache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 час

function getCached(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() - item.timestamp > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return item.data;
}

function setCached(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
}

// ============================================
// СРЕДНИЕ ЗАРПЛАТЫ
// ============================================
router.get('/salary', async (req, res) => {
  const query = req.query.query;
  if (!query || !String(query).trim()) {
    return res.status(400).json({ error: 'Параметр query обязателен' });
  }

  const cacheKey = `salary:${query}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json({ ...cached, cached: true });

  const result = await getSalaryStats(String(query));
  setCached(cacheKey, result);
  res.json({ ...result, cached: false });
});

// ============================================
// СПИСОК ВАКАНСИЙ
// ============================================
router.get('/vacancies', async (req, res) => {
  const query = req.query.query;
  const limit = parseInt(req.query.limit) || 5;

  if (!query || !String(query).trim()) {
    return res.status(400).json({ error: 'Параметр query обязателен' });
  }

  const cacheKey = `vacancies:${query}:${limit}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json({ vacancies: cached, count: cached.length, cached: true });

  const vacancies = await getVacancies(String(query), limit);
  setCached(cacheKey, vacancies);
  res.json({ vacancies, count: vacancies.length, cached: false });
});

// ============================================
// ТОП НАВЫКОВ
// ============================================
router.get('/skills', async (req, res) => {
  const query = req.query.query;
  if (!query || !String(query).trim()) {
    return res.status(400).json({ error: 'Параметр query обязателен' });
  }

  const cacheKey = `skills:${query}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json({ skills: cached, cached: true });

  const skills = await getTopSkills(String(query));
  setCached(cacheKey, skills);
  res.json({ skills, cached: false });
});

module.exports = router;
