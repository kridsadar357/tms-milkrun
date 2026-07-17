# Portable single-service image: builds the frontend and serves it + the API.
# Works on Fly.io, Railway, Google Cloud Run, or any container host.

# --- build stage: compile the client bundle ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Optional build-time Mapbox token (the app also accepts one entered in Settings).
ARG VITE_MAPBOX_TOKEN=""
ENV VITE_MAPBOX_TOKEN=$VITE_MAPBOX_TOKEN
RUN npm run build

# --- runtime stage: production deps + built assets + server ---
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY server ./server
# DATABASE_URL is provided at runtime by the host; PORT defaults to 3001.
EXPOSE 3001
CMD ["node", "server/index.mjs"]
