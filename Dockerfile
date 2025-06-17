FROM node:20-alpine
RUN apk --no-cache add curl

RUN mkdir /app
WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./

RUN npm install

COPY src ./src

CMD ["/app/node_modules/.bin/tsx", "./src/index.ts", "-p", "/config/wp-continuous-integration-config.yaml"]
