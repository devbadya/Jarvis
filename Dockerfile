# Optional tool proxy, and hosted Claude Opus when ANTHROPIC_API_KEY is set.
# The Pages site stays static. Railway (or any host) runs this image.
FROM node:22-alpine

WORKDIR /app
COPY tools/agent-api.ts tools/agent-api-listen.ts tools/agent-chat.ts ./tools/

ENV NODE_ENV=production
EXPOSE 8787

CMD ["node", "--experimental-strip-types", "tools/agent-api-listen.ts"]
