FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node package.json server.mjs index.html app.js content.mjs styles.css ./
COPY --chown=node:node assets/ ./assets/

USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
