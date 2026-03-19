// Middleware для проверки токена
// Этот файл защищает роуты — без токена не пустит

const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
  // Токен приходит в заголовке: Authorization: Bearer <token>
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Токен не предоставлен. Войдите в систему.' });
  }

  const token = authHeader.split(' ')[1]; // берём только сам токен

  try {
    // Проверяем токен и достаём данные пользователя
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // кладём данные пользователя в запрос
    next(); // пропускаем дальше
  } catch (error) {
    return res.status(401).json({ error: 'Недействительный или просроченный токен. Войдите снова.' });
  }
};

module.exports = authMiddleware;