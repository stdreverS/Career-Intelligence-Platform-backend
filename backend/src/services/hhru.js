// Сервис для работы с открытым API hh.ru
// Документация: https://api.hh.ru/openapi/

const BASE_URL = 'https://api.hh.ru';
const USER_AGENT = 'CarIP/1.0 (career-intelligence-platform)';

async function hhFetch(path) {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (error) {
    console.error('hh.ru fetch error:', error.message);
    return null;
  }
}

// Средние зарплаты по позиции
async function getSalaryStats(query, area = 1) {
  if (!query || !query.trim()) return null;

  const params = new URLSearchParams({
    text: query.trim(),
    area: String(area),
    per_page: '50',
    only_with_salary: 'true'
  });

  const data = await hhFetch(`/vacancies?${params.toString()}`);
  if (!data || !Array.isArray(data.items)) return null;

  let sumFrom = 0, countFrom = 0;
  let sumTo = 0, countTo = 0;

  for (const item of data.items) {
    const s = item.salary;
    if (!s) continue;
    if (typeof s.from === 'number') { sumFrom += s.from; countFrom++; }
    if (typeof s.to === 'number') { sumTo += s.to; countTo++; }
  }

  const salaryMin = countFrom ? Math.round(sumFrom / countFrom) : 0;
  const salaryMax = countTo ? Math.round(sumTo / countTo) : 0;

  return {
    salaryMin,
    salaryMax,
    vacanciesCount: data.found || data.items.length,
    query,
    currency: 'RUR'
  };
}

// Список реальных вакансий
async function getVacancies(query, area = 1, limit = 5) {
  if (!query || !query.trim()) return null;

  const params = new URLSearchParams({
    text: query.trim(),
    area: String(area),
    per_page: String(limit),
    only_with_salary: 'true',
    order_by: 'relevance'
  });

  const data = await hhFetch(`/vacancies?${params.toString()}`);
  if (!data || !Array.isArray(data.items)) return null;

  return data.items.map(item => ({
    id: item.id,
    title: item.name,
    company: item.employer?.name || null,
    salaryFrom: item.salary?.from ?? null,
    salaryTo: item.salary?.to ?? null,
    url: item.alternate_url,
    area: item.area?.name || null,
    requirement: item.snippet?.requirement || ''
  }));
}

// Топ-10 ключевых навыков по позиции
async function getTopSkills(query) {
  if (!query || !query.trim()) return null;

  const params = new URLSearchParams({
    text: query.trim(),
    area: '113',
    per_page: '50'
  });

  const data = await hhFetch(`/vacancies?${params.toString()}`);
  if (!data || !Array.isArray(data.items)) return null;

  const counter = new Map();

  // Детальные данные о вакансии нужны для key_skills — берём из подробного эндпоинта
  const detailFetches = data.items.slice(0, 20).map(item =>
    hhFetch(`/vacancies/${item.id}`)
  );
  const details = await Promise.all(detailFetches);

  for (const v of details) {
    if (!v || !Array.isArray(v.key_skills)) continue;
    for (const sk of v.key_skills) {
      if (!sk?.name) continue;
      const key = sk.name.trim();
      counter.set(key, (counter.get(key) || 0) + 1);
    }
  }

  return [...counter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));
}

module.exports = { getSalaryStats, getVacancies, getTopSkills };
