FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY server.mjs index.html app.js content.mjs styles.css ./
COPY lib/ ./lib/
COPY assets/ ./assets/

USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
