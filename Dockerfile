FROM node:18-alpine

WORKDIR /app

# Create data directory for SQLite
RUN mkdir -p /data

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 8080

CMD ["npm", "start"]
