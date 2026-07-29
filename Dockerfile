FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN DATABASE_URL="postgresql://postgres:password@localhost:5432/postgres" \
    DIRECT_URL="postgresql://postgres:password@localhost:5432/postgres" \
    npx prisma generate && npm prune --omit=dev

EXPOSE 3001

CMD ["node", "src/server.js"]
