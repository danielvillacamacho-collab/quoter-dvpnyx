FROM node:20-alpine AS client-build
WORKDIR /app/client
# Build-time env vars baked into the JS bundle by CRA.
# deploy.yml passes --build-arg REACT_APP_GIT_SHA=<short-sha> so the
# footer shows the exact commit in every browser for bug reports.
ARG REACT_APP_GIT_SHA=local
ARG REACT_APP_VERSION=2.0.0
ENV REACT_APP_GIT_SHA=$REACT_APP_GIT_SHA
ENV REACT_APP_VERSION=$REACT_APP_VERSION
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev
COPY server/ ./server/
COPY --from=client-build /app/client/build ./client/build
EXPOSE 4000
CMD ["sh", "-c", "cd server && node database/migrate.js && node database/seed.js && node index.js"]
