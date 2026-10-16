# Node service. Listens on $PORT (default 8080).
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; \
    elif [ -f package.json ]; then npm install --omit=dev; fi
# Install Docker CLI for container management
RUN apk add --no-cache docker-cli mysql-client
COPY . .
RUN chown -R node:node /app
USER node
ENV PORT=8088 NODE_ENV=production
EXPOSE 8088
CMD ["node", "main.js"]
