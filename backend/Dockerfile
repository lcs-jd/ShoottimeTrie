FROM node:20-alpine

RUN apk add --no-cache vips-dev python3 make g++

WORKDIR /app

COPY package.json .
RUN npm install --production

COPY src/ ./src/

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PORT=3000

EXPOSE 3000

CMD ["node", "src/server.js"]
