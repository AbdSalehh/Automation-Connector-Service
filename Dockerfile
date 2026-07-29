FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npx prisma generate && npm prune --omit=dev

EXPOSE 3001

CMD ["node", "src/server.js"]
