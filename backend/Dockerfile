# Dockerfile — инструкция для создания образа нашего сервера
# Docker читает этот файл и создаёт "контейнер" с нашим приложением

# Берём базовый образ Node.js (лёгкая Alpine версия)
FROM node:20-slim
RUN apt-get update -y && apt-get install -y openssl

# Устанавливаем рабочую директорию внутри контейнера
WORKDIR /app

# Копируем файлы зависимостей
COPY package*.json ./
COPY prisma ./prisma/

# Устанавливаем зависимости
RUN npm install

# Генерируем Prisma клиент (нужно после npm install)
RUN npx prisma generate

# Копируем весь остальной код
COPY . .

# Открываем порт
EXPOSE 3001

# Команда запуска (выполняем миграции БД, потом запускаем сервер)
CMD ["sh", "-c", "npx prisma migrate deploy && node src/index.js"]