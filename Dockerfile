FROM node:26-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
# prisma.config.ts resolves DATABASE_URL eagerly even for `generate` (no live
# connection needed); a placeholder scoped to this RUN only is safe -- the
# real DATABASE_URL from docker-compose's `environment:` overrides it at runtime.
RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" npx prisma generate

EXPOSE 3000

CMD ["npm", "run", "dev"]
