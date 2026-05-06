# Career Intelligence Platform — Backend

## What is this

CarIP is an AI-powered resume analysis and career planning platform. The backend handles
authentication, AI chat sessions, resume generation, salary data, and business logic.

Pitch: "Not just a resume builder — it builds a personal career plan: shows skill gaps
for the target role and gives a step-by-step path with checklists and course recommendations."

---

## Tech Stack

- Runtime: Node.js v25
- Framework: Express.js
- ORM: Prisma 5.22
- Database: PostgreSQL 16 (hosted on Railway)
- AI: Groq API — model llama-3.3-70b-versatile (free tier)
- Auth: JWT tokens, 7-day expiry, bcryptjs
- Rate limiting: 100 req/15min global, 10 req/15min for /auth
- Salary data: JSearch API (RapidAPI) + static reference of 40+ roles
- Deploy: Railway.app — auto-deploy from GitHub main branch

---

## Project Structure
backend/src/index.js              - Express server, middleware, route mounting
backend/src/prisma.js             - Single shared PrismaClient instance
backend/src/middleware/auth.js    - JWT verification middleware
backend/src/routes/auth.js        - /register /login /me /account
backend/src/routes/chat.js        - sessions, messages, context compression
backend/src/routes/resume.js      - resume retrieval, PDF data
backend/src/routes/jobs.js        - salary, vacancies, skills
backend/src/services/ai.js        - Groq integration, system prompt, validation
backend/src/services/salaryService.js - JSearch API + in-memory cache (1 hour)
backend/prisma/schema.prisma
backend/prisma/migrations/
backend/Dockerfile                - node:20-slim + openssl

---

## Database Schema

User
  id             uuid, primary key
  email          string, unique
  name           string
  password       string, bcrypt hash
  sessions       ChatSession[]
  resumes        Resume[]

ChatSession
  id             uuid, primary key
  userId         foreign key -> User
  title          string (updated with user name from resume)
  contextSummary text, AI-compressed context to save DB space
  messages       ChatMessage[]
  resume         Resume? (optional, 1:1)

ChatMessage
  id             uuid, primary key
  sessionId      foreign key -> ChatSession
  role           enum: user | assistant
  content        text

Resume
  id             uuid, primary key
  userId         foreign key -> User
  sessionId      foreign key -> ChatSession, unique (1:1)
  targetPosition string
  currentSalary  string
  futureSalary   string
  content        text (JSON stringified — full resume + gap analysis)

---

## API Routes

Auth /api/auth
  POST   /register       Register new user
  POST   /login          Login by email OR username (name field)
  GET    /me             Current user data (requires JWT)
  DELETE /account        Delete account (requires JWT)

Chat /api/chat
  POST   /session            Create new session (compresses previous)
  GET    /sessions           All sessions (compresses current)
  GET    /session/:id        Session with messages
  POST   /session/:id/message  Send message
  DELETE /session/:id        Delete session

Resume /api/resume
  GET    /my             All resumes for current user
  GET    /:id            Single resume by id
  GET    /:id/data-for-pdf  Data shaped for PDF export

Jobs /api/jobs
  GET    /salary?query=...     Salary range for a role
  GET    /vacancies?query=...  Real job listings
  GET    /skills?query=...     Top skills for a role

System
  GET    /api/health     Server + DB status check

---

## Key Business Logic

AI Chat Flow:
1. User creates a session
2. AI asks questions one at a time: name, city, education, hard skills, soft skills, experience, target role, salary expectations
3. Every message is validated on the backend — prompt injection and off-topic input are blocked
4. After 8+ messages with a detected role keyword, real salary data is injected into AI context
5. AI generates resume in markdown + embedded JSON block
6. JSON block is parsed and saved to Resume table
7. After generation, only style and tone corrections are allowed — no re-generation

Context Compression (triggered on session switch, new session, history load):
1. All messages in the session are summarized into one text via AI
2. Original messages are deleted from DB
3. Summary is stored in ChatSession.contextSummary
4. On next load, AI receives the summary instead of full message history

Salary Data Priority:
1. JSearch API via RapidAPI (200 req/day free)
2. Static reference map (40+ roles, Russian job market data)
3. In-memory cache: 1 hour TTL

---

## Environment Variables

DATABASE_URL    postgresql://...   Railway PostgreSQL connection string
JWT_SECRET      string             Long random secret for signing tokens
GROQ_API_KEY    gsk_...            Groq API key (free tier)
FRONTEND_URL    https://...        Vercel frontend URL — used for CORS
RAPIDAPI_KEY    string             JSearch via RapidAPI (optional, has static fallback)
PORT            3001

---

## Hard Rules — Never Violate

- Always use the single PrismaClient from require('../prisma') — never instantiate a new one
- Never modify src/services/ai.js system prompt or validation logic without explicit instruction
- Never change prisma/schema.prisma without creating a migration in prisma/migrations/
- Never hardcode FRONTEND_URL — always read from process.env.FRONTEND_URL for CORS
- Login must accept both email and name (username) — both paths must stay working
- html2pdf.js on frontend must only be loaded via dynamic import() — never static import

---

## Development Workflow

- Branch dev for development, branch main for production
- Push to main triggers Railway auto-deploy
- Local run: cd backend && node src/index.js
- DATABASE_URL points to Railway PostgreSQL even in local dev — no local DB needed
- Docker has networking issues on Arch Linux — run directly with node src/index.js

---

## Next Features (Priority Order)

1. Skill verification mini-tests
   GET  /api/skills/quiz?skill=...    generate 3-5 questions via Groq
   POST /api/skills/quiz/submit       score answers, store result in Resume.content as verifiedSkills[]

2. Gap analysis export
   GET  /api/resume/:id/gap-report    returns missingSkills[], recommendedCourses[], estimatedTimeMonths

3. GitHub profile integration
   fetch public repos and languages, inject summary into resume AI context

4. Email notifications
   session summary, resume ready alert, weekly career tips

5. Freemium enforcement
   track resume count per user, block Free tier at 1 resume/month

---

## Known Issues

- Occasional unicode artifacts (square symbols) appear in AI-generated resume text
- Back-navigation after ResumeEditor sometimes lands on wrong session (frontend side)
