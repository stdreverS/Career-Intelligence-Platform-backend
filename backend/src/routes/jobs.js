// Роуты вакансий — обёртка над hh.ru API
const express = require('express');
const authMiddleware = require('../middleware/auth');
const { getSalaryStats, getVacancies, getTopSkills } = require('../services/hhru');

const router = express.Router();

router.use(authMiddleware);

// ============================================
// КЭШ — чтобы не долбить hh.ru на каждый запрос
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
  const { query, area = '1' } = req.query;
  if (!query || !String(query).trim()) {
    return res.status(400).json({ error: 'Параметр query обязателен' });
  }

  const cacheKey = `salary:${query}:${area}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  const stats = await getSalaryStats(String(query), Number(area));
  if (!stats) {
    return res.status(503).json({ error: 'hh.ru недоступен' });
  }

  setCached(cacheKey, stats);
  res.json(stats);
});

// ============================================
// СПИСОК ВАКАНСИЙ
// ============================================
router.get('/vacancies', async (req, res) => {
  const { query, area = '1', limit = '5' } = req.query;
  if (!query || !String(query).trim()) {
    return res.status(400).json({ error: 'Параметр query обязателен' });
  }

  const cacheKey = `vacancies:${query}:${area}:${limit}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  const vacancies = await getVacancies(String(query), Number(area), Number(limit));
  if (!vacancies) {
    return res.status(503).json({ error: 'hh.ru недоступен' });
  }

  setCached(cacheKey, vacancies);
  res.json(vacancies);
});

// ============================================
// ТОП НАВЫКОВ
// ============================================
router.get('/skills', async (req, res) => {
  const { query } = req.query;
  if (!query || !String(query).trim()) {
    return res.status(400).json({ error: 'Параметр query обязателен' });
  }

  const cacheKey = `skills:${query}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  const skills = await getTopSkills(String(query));
  if (!skills) {
    return res.status(503).json({ error: 'hh.ru недоступен' });
  }

  setCached(cacheKey, skills);
  res.json(skills);
});

module.exports = router;
