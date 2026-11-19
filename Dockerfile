# Sahay server image (Hugging Face Spaces / any Docker host).
# Spaces route traffic to port 7860 and run the container as uid 1000 (the `node` user here).
FROM node:24-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .
RUN mkdir -p data && chown -R node:node /app

USER node
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=7860
EXPOSE 7860
CMD ["node", "server.js"]
