FROM node:19-alpine

RUN npm install -g pnpm

WORKDIR /usr/src/qubic-js-peer-matcher

COPY package.json ./

COPY . .

RUN pnpm fetch --prod \
    && pnpm i --prod

EXPOSE 8081
CMD [ "node", "./src/server.js" ]