FROM node:19

RUN apt-get install python3 make g++
RUN npm install -g pnpm @mapbox/node-pre-gyp

WORKDIR /usr/src/qubic-js-gateway

RUN mkdir gateway 

COPY ./gateway/package.json ./gateway
COPY . .

RUN cd gateway && pnpm fetch --prod
RUN CI=true pnpm i --prod --frozen-lockfile
CMD [ "node", "./gateway/src/gateway.js" ]