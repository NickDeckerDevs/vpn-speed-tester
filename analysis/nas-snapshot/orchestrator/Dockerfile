FROM node:20-slim

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    git \
    --no-install-recommends \
  && pip3 install speedtest-cli --break-system-packages \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

CMD ["node", "main.js"]
