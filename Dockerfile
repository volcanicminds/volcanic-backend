FROM node:16-alpine

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