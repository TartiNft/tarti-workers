# Use Node.js as the base image
FROM node:18-alpine

LABEL service="tarti-nft-worker"

# Set the working directory inside the container
WORKDIR /app

# Copy the shared folder into the container
COPY ./shared ./shared

# Copy the service-specific files into the container
COPY ./tarti-nft-worker/index.js ./tarti-nft-worker/index.js

# Copy package.json and package-lock.json for dependency installation
COPY ./package*.json ./

# Install dependencies
RUN npm install --only=production

# Set the command to run the service
CMD ["node", "tarti-nft-worker/index.js"]
