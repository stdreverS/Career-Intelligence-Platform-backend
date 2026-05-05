// Зарплатный сервис: сначала пробуем JSearch API, если недоступен — статический fallback

// ============================================
// СТАТИЧЕСКИЕ ДАННЫЕ — fallback для оффлайна и при превышении лимита API
// ============================================
const SALARY_DATA = {
  // Junior
  'junior frontend':      { min: 60000,  max: 120000, currency: 'RUB' },
  'junior backend':       { min: 65000,  max: 130000, currency: 'RUB' },
  'junior fullstack':     { min: 70000,  max: 140000, currency: 'RUB' },
  'junior python':        { min: 65000,  max: 125000, currency: 'RUB' },
  'junior javascript':    { min: 60000,  max: 115000, currency: 'RUB' },
  'junior java':          { min: 70000,  max: 140000, currency: 'RUB' },
  'junior devops':        { min: 80000,  max: 150000, currency: 'RUB' },
  'junior data':          { min: 65000,  max: 130000, currency: 'RUB' },

  // Middle
  'middle frontend':      { min: 130000, max: 230000, currency: 'RUB' },
  'middle backend':       { min: 140000, max: 250000, currency: 'RUB' },
  'middle fullstack':     { min: 150000, max: 270000, currency: 'RUB' },
  'middle python':        { min: 140000, max: 250000, currency: 'RUB' },
  'middle javascript':    { min: 130000, max: 230000, currency: 'RUB' },
  'middle java':          { min: 150000, max: 280000, currency: 'RUB' },
  'middle devops':        { min: 160000, max: 290000, currency: 'RUB' },
  'middle data scientist':{ min: 150000, max: 280000, currency: 'RUB' },

  // Senior
  'senior frontend':      { min: 250000, max: 450000, currency: 'RUB' },
  'senior backend':       { min: 270000, max: 480000, currency: 'RUB' },
  'senior fullstack':     { min: 280000, max: 500000, currency: 'RUB' },
  'senior python':        { min: 260000, max: 470000, currency: 'RUB' },
  'senior java':          { min: 280000, max: 500000, currency: 'RUB' },
  'senior devops':        { min: 290000, max: 520000, currency: 'RUB' },

  // Прочие IT-роли
  'product manager':      { min: 120000, max: 300000, currency: 'RUB' },
  'project manager':      { min: 100000, max: 250000, currency: 'RUB' },
  'ux designer':          { min: 90000,  max: 220000, currency: 'RUB' },
  'ui designer':          { min: 80000,  max: 200000, currency: 'RUB' },
  'qa engineer':          { min: 80000,  max: 200000, currency: 'RUB' },
  'data analyst':         { min: 90000,  max: 220000, currency: 'RUB' },
  'системный аналитик':   { min: 100000, max: 240000, currency: 'RUB' },
  'бизнес аналитик':      { min: 100000, max: 250000, currency: 'RUB' },
  'разработчик':          { min: 80000,  max: 250000, currency: 'RUB' },
  'программист':          { min: 80000,  max: 250000, currency: 'RUB' },
  'тестировщик':          { min: 60000,  max: 150000, currency: 'RUB' },
  'менеджер проектов':    { min: 90000,  max: 220000, currency: 'RUB' },
  'team lead':            { min: 250000, max: 450000, currency: 'RUB' },
  'tech lead':            { min: 280000, max: 500000, currency: 'RUB' },
  'cto':                  { min: 350000, max: 700000, currency: 'RUB' },
};

function getStaticSalary(query) {
  const q = query.toLowerCase();
  const firstWord = q.split(' ')[0];
  for (const [key, value] of Object.entries(SALARY_DATA)) {
    if (q.includes(key) || key.includes(firstWord)) {
      return { ...value, source: 'static', query };
    }
  }
  // дефолт для IT, если ничего не подошло
  return { min: 80000, max: 200000, currency: 'RUB', source: 'static', query };
}

// ============================================
// JSEARCH API
// ============================================
async function getSalaryFromAPI(query) {
  if (!process.env.RAPIDAPI_KEY) return null;

  try {
    const response = await fetch(
      `https://jsearch.p.rapidapi.com/search?query=${encodeURIComponent(query + ' Russia')}&num_pages=1&page=1`,
      {
        headers: {
          'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
          'X-RapidAPI-Host': 'jsearch.p.rapidapi.com'
        }
      }
    );

    if (!response.ok) return null;

    const data = await response.json();
    const jobs = data.data || [];

    const salaries = jobs
      .filter(j => j.job_min_salary && j.job_max_salary)
      .map(j => ({
        min: j.job_min_salary,
        max: j.job_max_salary,
        currency: j.job_salary_currency || 'USD'
      }));

    if (salaries.length === 0) return null;

    const avgMin = Math.round(salaries.reduce((s, j) => s + j.min, 0) / salaries.length);
    const avgMax = Math.round(salaries.reduce((s, j) => s + j.max, 0) / salaries.length);

    // Грубая конвертация USD → RUB, если зарплата пришла в долларах
    const multiplier = salaries[0].currency === 'USD' ? 90 : 1;

    return {
      min: avgMin * multiplier,
      max: avgMax * multiplier,
      currency: 'RUB',
      source: 'jsearch',
      vacanciesCount: jobs.length,
      query
    };
  } catch {
    return null;
  }
}

// ============================================
// ПУБЛИЧНЫЕ ФУНКЦИИ
// ============================================
async function getSalaryStats(query) {
  const apiResult = await getSalaryFromAPI(query);
  if (apiResult) return apiResult;
  return getStaticSalary(query);
}

async function getVacancies(query, limit = 5) {
  if (!process.env.RAPIDAPI_KEY) return [];

  try {
    const response = await fetch(
      `https://jsearch.p.rapidapi.com/search?query=${encodeURIComponent(query)}&num_pages=1&page=1`,
      {
        headers: {
          'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
          'X-RapidAPI-Host': 'jsearch.p.rapidapi.com'
        }
      }
    );

    if (!response.ok) return [];
    const data = await response.json();

    return (data.data || []).slice(0, limit).map(j => ({
      id: j.job_id,
      title: j.job_title,
      company: j.employer_name,
      salaryFrom: j.job_min_salary,
      salaryTo: j.job_max_salary,
      url: j.job_apply_link,
      location: j.job_city || j.job_country,
      description: j.job_description?.slice(0, 200)
    }));
  } catch {
    return [];
  }
}

// Статическая карта навыков по типу позиции
const SKILLS_MAP = {
  frontend:  ['React', 'TypeScript', 'JavaScript', 'CSS', 'HTML', 'Vue', 'Redux', 'webpack'],
  backend:   ['Node.js', 'Python', 'Java', 'PostgreSQL', 'Redis', 'Docker', 'REST API', 'Git'],
  fullstack: ['React', 'Node.js', 'TypeScript', 'PostgreSQL', 'Docker', 'Git', 'REST API'],
  python:    ['Python', 'Django', 'FastAPI', 'PostgreSQL', 'Redis', 'Docker', 'Git'],
  java:      ['Java', 'Spring Boot', 'PostgreSQL', 'Maven', 'Docker', 'Microservices'],
  devops:    ['Docker', 'Kubernetes', 'CI/CD', 'Linux', 'AWS', 'Terraform', 'Git'],
  data:      ['Python', 'SQL', 'pandas', 'scikit-learn', 'TensorFlow', 'Jupyter', 'Git'],
  designer:  ['Figma', 'Adobe XD', 'Sketch', 'Prototyping', 'UX Research', 'CSS'],
  qa:        ['Selenium', 'Postman', 'SQL', 'Git', 'JIRA', 'TestRail', 'Python'],
  manager:   ['JIRA', 'Confluence', 'Agile', 'Scrum', 'Kanban', 'MS Project']
};

async function getTopSkills(query) {
  const q = query.toLowerCase();
  for (const [key, skills] of Object.entries(SKILLS_MAP)) {
    if (q.includes(key)) return skills;
  }
  return ['Git', 'SQL', 'Linux', 'Docker', 'REST API', 'Agile'];
}

module.exports = { getSalaryStats, getVacancies, getTopSkills };
