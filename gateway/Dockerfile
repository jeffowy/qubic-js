FROM node:19

RUN apt-get install python3 make g++
RUN npm install -g pnpm @mapbox/node-pre-gyp

WORKDIR /usr/src/qubic-js-gateway

COPY package.json ./

COPY . .

RUN pnpm fetch --prod \
    && pnpm i --prod

EXPOSE 8080
CMD [ "node", "./src/gateway.js" ]