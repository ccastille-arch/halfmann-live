FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npx vite build

FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/server ./server
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "server/index.js"]
