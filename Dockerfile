FROM --platform=linux/amd64 node:18-alpine

LABEL version="0.1.0"
LABEL description="Volcanic Backend"
LABEL maintainer="Developers <developers@volcanicminds.com>"

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json yarn.lock ./
COPY lib lib/

RUN yarn install

# Bundle app source
COPY . .

EXPOSE 2230
CMD [ "yarn", "start" ]