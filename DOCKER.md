# Docker

try to use these to run the app in a docker node:16-alpine image:

```js

// easy
docker build -t volcanic-backend .
docker run -dp 2230:2230 -it volcanic-backend

// detached mode with autoremove when stopped
docker run --rm -dp 2230:2230 -it volcanic-backend

// attached mode with autoremove when stopped
docker run --rm -p 2230:2230 -it volcanic-backend

// remove
docker image rm volcanic-backend

// prune all
docker system prune --all

```
