FROM node:22-bookworm-slim

# git нужен Claude Code (история файлов, чекпоинты); tini — корректные сигналы для node
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates tini curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# зависимости отдельным слоем для кэширования
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-fund --no-audit

# код и seed-конфиг workspace (ensureWorkspace досоздаст недостающее при старте)
COPY server ./server
COPY public ./public
COPY workspace ./workspace

# непривилегированный пользователь node (uid 1000, уже есть в образе);
# HOME — для ~/.claude (сессии, плагины, транскрипты)
RUN mkdir -p /home/node/.claude \
 && chown -R node:node /app /home/node/.claude
USER node

ENV HOME=/home/node \
    HOST=0.0.0.0 \
    SPORTCHAT_PORT=3777

EXPOSE 3777
VOLUME ["/home/sportchat/.claude"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.SPORTCHAT_PORT||3777)+'/api/meta').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server/index.js"]
