FROM node:latest

# Create app directories
RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

# Set operational variables
ENV NODE_ENV production
ENV PORT 80

# Bundle app source
COPY . .

# Install app dependencies
COPY package.json .
RUN npm install

CMD [ "npm", "start" ]
