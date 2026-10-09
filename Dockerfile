FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm ci && npm prune --omit=dev
ENV BD_CONNECTOR_DATA_DIR=/data BD_CONNECTOR_PORT=8080
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8080
USER node
CMD ["node", "dist/index.js", "serve"]
