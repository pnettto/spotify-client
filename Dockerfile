FROM denoland/deno:debian

WORKDIR /app

# 1. Install git
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# 2. Copy git config and metadata (ensure .git is not in .dockerignore)
COPY .git .git
COPY .gitmodules .gitmodules

# 3. Update submodules
# If private, you must pass credentials or use SSH forwarding
RUN git submodule update --init --recursive

# 4. Copy rest of application
COPY . .

RUN deno cache main.ts

EXPOSE 8888

CMD ["run", "--allow-net", "--allow-read", "--allow-env", "main.ts"]