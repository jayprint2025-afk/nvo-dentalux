FROM node:18-alpine

# Instalamos herramientas necesarias para compilar algunas librerías de Node si fuera necesario
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copiamos archivos de dependencias
COPY package*.json ./

# Instalamos dependencias (incluyendo las de producción y desarrollo necesarias)
RUN npm install

# Copiamos el resto del código (server.js, carpetas de rutas, etc.)
COPY . .

# Exponemos el puerto que tu server.js usa (10000 es el default de Render)
EXPOSE 10000

# Comando para arrancar tu app según tu package.json
CMD ["node", "server.js"]