# Node service. Listens on $PORT (default 8080).
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; \
    elif [ -f package.json ]; then npm install --omit=dev; fi
COPY . .
RUN chown -R node:node /app
USER node
ENV PORT=8080 NODE_ENV=production
EXPOSE 8080
CMD ["node", "main.js"]
