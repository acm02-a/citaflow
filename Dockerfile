# CitaFlow — imagen de producción. Datos en Supabase (no necesita volumen).
FROM node:20-alpine
WORKDIR /app

# Instala dependencias en la imagen (Linux), no copia las de tu Windows.
COPY package*.json ./
RUN npm ci --omit=dev

# Copia el resto del código (el .env queda fuera por .dockerignore: los
# secretos se pasan en runtime con -e / --env-file, nunca dentro de la imagen).
COPY . .

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000
CMD ["node", "server.mjs"]
