# Docker

try to use these to run the app in a docker node:16 image:

```js

docker build . -t volcanic-backend

// easy
docker run -p 2230:2230 volcanic-backend

// detached mode
docker run --rm -dp 2230:2230 volcanic-backend

// attached mode
docker run --rm -it -p 2230:2230 volcanic-backend

// remove
docker image rm volcanic-backend
```
