FROM denoland/deno:debian

WORKDIR /app

# Copy configuration files first to resolve dependencies
COPY deno.json* deno.lock* ./
COPY main.ts .

# Cache dependencies
RUN deno cache main.ts

COPY . .

EXPOSE 8888

CMD ["run", "--allow-net", "--allow-read", "--allow-env", "main.ts"]