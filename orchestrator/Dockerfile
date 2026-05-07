FROM node:20-slim

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    --no-install-recommends \
  && pip3 install speedtest-cli --break-system-packages \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

CMD ["node", "main.js"]
