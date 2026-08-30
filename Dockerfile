# Optional tool proxy only. The Pages site stays static; inference stays in the tab.
# Railway (or any host) runs this image and generates a public URL for Tools → Tool proxy URL.
FROM node:22-alpine

WORKDIR /app
COPY tools/agent-api.ts tools/agent-api-listen.ts ./tools/

ENV NODE_ENV=production
EXPOSE 8787

CMD ["node", "--experimental-strip-types", "tools/agent-api-listen.ts"]
