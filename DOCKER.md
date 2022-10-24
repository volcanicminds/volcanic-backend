# Docker

try to use these to run the app in a docker node:16 image:

```js
docker run -it --rm --entrypoint yarn -v "$PWD":/app --workdir /app -p 2230:2230 node:16 install
docker run -it --rm --entrypoint yarn -v "$PWD":/app --workdir /app -p 2230:2230 node:16 dev
```
