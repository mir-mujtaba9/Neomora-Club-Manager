# Stage 1: Build the NestJS application
FROM node:22-alpine AS builder

WORKDIR /usr/src/app

# Copy dependency definition files and Prisma schema
COPY package*.json ./
COPY prisma ./prisma/

# Install all dependencies (production + development)
RUN npm ci

# Copy the rest of the application source code
COPY . .

# Generate Prisma client before building (needed for TS compilation)
# We supply a dummy DATABASE_URL here because Prisma 7 config-loading throws if env var is missing,
# even though the schema compilation itself does not establish database connections.
RUN DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy npx prisma generate

# Compile TypeScript to JavaScript (outputs to dist/)
RUN npm run build

# Remove development dependencies to minimize Docker image size
RUN npm prune --production

# Stage 2: Production runtime environment
FROM node:22-alpine AS runner

WORKDIR /usr/src/app

# Set production environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Install ts-node + typescript globally so prisma migrate deploy can parse prisma.config.ts
RUN npm install -g ts-node typescript

# Copy package config, prisma schema, and Prisma 7 config file
COPY package*.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./
COPY tsconfig.json ./

# Copy compiled files and production node_modules from the builder stage
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/dist ./dist

# Expose port 3000 (standard for the app, Render will bind its external port here)
EXPOSE 3000

# Run migrations to verify database schema matches, then start the app
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start:prod"]
