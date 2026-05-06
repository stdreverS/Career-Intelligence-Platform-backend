// Интеграция с публичным GitHub API: тянем профиль и репозитории,
// извлекаем используемые языки и подмешиваем их в skills.hard резюме.

const express = require('express');
const prisma = require('../prisma');
const authMiddleware = require('../middleware/auth');
const validateUUID = require('../middleware/validateUUID');

const router = express.Router();

router.use(authMiddleware);

const GITHUB_API = 'https://api.github.com';
const USER_AGENT = 'CarIP-Backend/1.0';

// ============================================
// КЭШ — 10 минут на пользователя GitHub.
// Храним сырые ответы API, чтобы апдейт резюме всегда выполнялся.
// ============================================
// In-memory cache — resets on every server restart.
// TTL: 30 minutes for analysis, 10 minutes for github.
// This is acceptable for the current scale.
// Future: replace with Redis if multi-instance deploy is needed.
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

function getCached(username) {
  const item = cache.get(username);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    cache.delete(username);
    return null;
  }
  return item.data;
}

function setCached(username, data) {
  cache.set(username, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// GitHub разрешает: буквы, цифры, дефисы; не более 39 символов;
// дефис не в начале/конце и без подряд идущих
const USERNAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

function isValidUsername(value) {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > 39) return false;
  return USERNAME_PATTERN.test(value);
}

async function ghFetch(path) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/vnd.github+json'
    }
  });
  return res;
}

// ============================================
// POST /api/github/analyze
// ============================================
router.post('/analyze', validateUUID('resumeId'), async (req, res) => {
  const { username, resumeId } = req.body || {};

  if (!username || !resumeId) {
    return res.status(400).json({ error: 'Поля username и resumeId обязательны' });
  }

  if (!isValidUsername(username)) {
    return res.status(400).json({ error: 'Некорректный username GitHub' });
  }

  // Проверяем что резюме принадлежит пользователю
  const resume = await prisma.resume.findFirst({ where: { id: resumeId } });
  if (!resume) {
    return res.status(404).json({ error: 'Резюме не найдено' });
  }
  if (resume.userId !== req.user.userId) {
    return res.status(403).json({ error: 'Нет доступа к этому резюме' });
  }

  // Тянем GitHub (или берём из кэша)
  let userData, repos;
  const cached = getCached(username);
  if (cached) {
    userData = cached.userData;
    repos = cached.repos;
  } else {
    try {
      const userRes = await ghFetch(`/users/${encodeURIComponent(username)}`);
      if (userRes.status === 404) {
        return res.status(404).json({ error: 'GitHub user not found' });
      }
      if (!userRes.ok) {
        return res.status(502).json({ error: 'GitHub API unavailable, try again later' });
      }
      userData = await userRes.json();

      const reposRes = await ghFetch(`/users/${encodeURIComponent(username)}/repos?sort=pushed&per_page=20`);
      if (!reposRes.ok) {
        return res.status(502).json({ error: 'GitHub API unavailable, try again later' });
      }
      repos = await reposRes.json();
      if (!Array.isArray(repos)) repos = [];

      setCached(username, { userData, repos });
    } catch (err) {
      console.error('GitHub fetch error:', err);
      return res.status(502).json({ error: 'GitHub API unavailable, try again later' });
    }
  }

  // Топ-6 языков по количеству упоминаний
  const langCounter = new Map();
  for (const repo of repos) {
    if (repo && typeof repo.language === 'string' && repo.language.length > 0) {
      langCounter.set(repo.language, (langCounter.get(repo.language) || 0) + 1);
    }
  }
  const topLanguages = [...langCounter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([lang]) => lang);

  // Топ-5 репозиториев по звёздам
  const topRepos = [...repos]
    .sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0))
    .slice(0, 5)
    .map(r => ({
      name: r.name,
      description: r.description || '',
      language: r.language || null,
      stars: r.stargazers_count || 0,
      url: r.html_url
    }));

  // Обновляем skills.hard в резюме
  let addedSkills = [];
  let resumeUpdateSkipped = false;
  let content;
  try {
    content = JSON.parse(resume.content);
  } catch {
    resumeUpdateSkipped = true;
  }

  if (!resumeUpdateSkipped) {
    if (!content.resume) content.resume = {};
    if (!content.resume.skills) content.resume.skills = {};

    const existing = Array.isArray(content.resume.skills.hard)
      ? content.resume.skills.hard
      : [];
    const existingLower = new Set(existing.map(s => String(s).toLowerCase()));

    addedSkills = topLanguages.filter(lang => !existingLower.has(lang.toLowerCase()));
    content.resume.skills.hard = [...existing, ...addedSkills];

    await prisma.resume.update({
      where: { id: resume.id },
      data: { content: JSON.stringify(content) }
    });
  }

  const response = {
    username: userData.login || username,
    profileUrl: userData.html_url || `https://github.com/${username}`,
    avatarUrl: userData.avatar_url || '',
    publicRepos: userData.public_repos || 0,
    followers: userData.followers || 0,
    topLanguages,
    topRepos,
    addedSkills,
    resumeId: resume.id
  };

  if (resumeUpdateSkipped) response.resumeUpdateSkipped = true;

  res.json(response);
});

module.exports = router;
