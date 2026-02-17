FROM node:18-alpine

# Install rclone for backups
RUN apk add --no-cache rclone

WORKDIR /app

# Create data directory
RUN mkdir -p /data

COPY package*.json ./
RUN npm install

COPY . .

# Make backup script executable
RUN chmod +x backup.sh

EXPOSE 8080

CMD ["npm", "start"]
