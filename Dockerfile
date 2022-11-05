FROM node:16-alpine

LABEL version="0.1.0"
LABEL description="Volcanic Backend"
LABEL maintainer="Developers <developers@volcanicminds.com>"

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json yarn.lock ./
COPY lib lib/

RUN yarn install
RUN apk --no-cache add curl

# Bundle app source
COPY . .

EXPOSE 2230
CMD [ "yarn", "start" ]