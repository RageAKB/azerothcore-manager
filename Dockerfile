# Node service. Listens on $PORT (default 8080).
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; \
    elif [ -f package.json ]; then npm install --omit=dev; fi
# Install Docker CLI (static binary) and MySQL client
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
    default-mysql-client \
    curl \
    ca-certificates \
    && curl -fsSL https://download.docker.com/linux/static/stable/x86_64/docker-27.5.1.tgz | tar xz --strip-components=1 -C /usr/local/bin docker/docker \
    && rm -rf /var/lib/apt/lists/*
COPY . .
RUN chown -R node:node /app && \
    chmod +x entrypoint.sh
USER node
ENV PORT=8088 NODE_ENV=production
EXPOSE 8088
ENTRYPOINT ["./entrypoint.sh"]
