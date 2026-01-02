import { Hono } from "hono";
import { serveStatic } from "hono/deno";
import "@std/dotenv/load";
import { exists } from "@std/fs/exists";

const app = new Hono();

const CLIENT_ID = Deno.env.get("SPOTIFY_CLIENT_ID");
const CLIENT_SECRET = Deno.env.get("SPOTIFY_CLIENT_SECRET");
const REDIRECT_URI = Deno.env.get("SPOTIFY_REDIRECT_URI") ||
  "http://127.0.0.1:8888/callback";

console.log(`\n🚀 Server started at http://localhost:8888`);
console.log(`🔗 Spotify Redirect URI: ${REDIRECT_URI}\n`);
const TOKEN_FILE = "./.refresh_token";
const CACHE_FILE = "./.albums_cache.json";

interface Album {
  name: string;
  artist: string;
  year: string;
  full_date: string;
  cover: string;
  link: string;
  genres: string[];
}

interface SpotifyAlbumItem {
  album: {
    name: string;
    artists: { id: string; name: string }[];
    release_date: string;
    images: { url: string }[];
    external_urls: { spotify: string };
  };
}

// Helper to get access token from refresh token
async function getAccessTokenFromRefresh() {
  if (!(await exists(TOKEN_FILE))) return null;
  const refreshToken = await Deno.readTextFile(TOKEN_FILE);
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Authorization": "Basic " + btoa(`${CLIENT_ID}:${CLIENT_SECRET}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const data = await response.json();
  return data.access_token;
}

// 1. Login flow
app.get("/login", (c) => {
  const scope = "user-library-read";
  const authUrl = new URL("https://accounts.spotify.com/authorize");
  authUrl.searchParams.append("response_type", "code");
  authUrl.searchParams.append("client_id", CLIENT_ID!);
  authUrl.searchParams.append("scope", scope);
  authUrl.searchParams.append("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.append("show_dialog", "true");
  return c.redirect(authUrl.toString());
});

app.get("/callback", async (c) => {
  const code = c.req.query("code");
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Authorization": "Basic " + btoa(`${CLIENT_ID}:${CLIENT_SECRET}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code || "",
      redirect_uri: REDIRECT_URI,
    }),
  });
  const data = await response.json();
  if (data.refresh_token) {
    await Deno.writeTextFile(TOKEN_FILE, data.refresh_token);
    return c.text("Logged in! Go back to the app.");
  }
  return c.text("Authentication failed", 400);
});

// 2. Optimized Sync Logic (50-item check)
async function syncLibrary(token: string) {
  const firstPageUrl = "https://api.spotify.com/v1/me/albums?limit=50";
  const firstRes = await fetch(firstPageUrl, {
    headers: { "Authorization": `Bearer ${token}` },
  });
  if (!firstRes.ok) throw new Error("Spotify error");
  const firstData = await firstRes.json();
  const firstBatch = firstData.items || [];

  let cached: Album[] = [];
  if (await exists(CACHE_FILE)) {
    cached = JSON.parse(await Deno.readTextFile(CACHE_FILE));
  }

  // Check if first 50 match
  const isMatch = cached.length >= firstBatch.length &&
    firstBatch.every((item: SpotifyAlbumItem, idx: number) =>
      item.album.external_urls.spotify === cached[idx]?.link
    );

  if (isMatch && cached.length > 0) {
    console.log("🚀 Sync: Match found, skipping full download.");
    return { status: "no_change", count: cached.length };
  }

  console.log("🔄 Sync: Difference detected, downloading all...");
  let all: Album[] = [];
  let nextUrl: string | null = firstPageUrl;
  let isFirst = true;

  while (nextUrl) {
    let data;
    if (isFirst) {
      data = firstData;
      isFirst = false;
    } else {
      const resp: Response = await fetch(nextUrl, {
        headers: { "Authorization": `Bearer ${token}` },
      });
      if (!resp.ok) break;
      data = await resp.json();
    }
    if (!data.items) break;

    const artistIds = [
      ...new Set(
        data.items.map((i: SpotifyAlbumItem) => i.album.artists[0].id),
      ),
    ].join(",");
    const genreMap: Record<string, string[]> = {};
    if (artistIds) {
      const artRes = await fetch(
        `https://api.spotify.com/v1/artists?ids=${artistIds}`,
        { headers: { "Authorization": `Bearer ${token}` } },
      );
      if (artRes.ok) {
        const artData = await artRes.json();
        artData.artists.forEach((a: { id: string; genres: string[] }) =>
          genreMap[a.id] = a.genres
        );
      }
    }

    const items: Album[] = data.items.map((i: SpotifyAlbumItem) => ({
      name: i.album.name,
      artist: i.album.artists.map((a) => a.name).join(", "),
      year: i.album.release_date.split("-")[0],
      full_date: i.album.release_date,
      cover: i.album.images[0]?.url || "",
      link: i.album.external_urls.spotify,
      genres: genreMap[i.album.artists[0].id] || [],
    }));

    all = [...all, ...items];
    nextUrl = data.next;
  }

  await Deno.writeTextFile(CACHE_FILE, JSON.stringify(all));
  return { status: "updated", count: all.length };
}

// Serve design-system static files
app.use(
  "/design-system/*",
  serveStatic({
    root: "./design-system/dist",
    rewriteRequestPath: (path) => path.replace(/^\/design-system/, ""),
  }),
);

// API Endpoints
app.use("/*", serveStatic({ root: "./public" }));

// Cache-only endpoint
app.get("/api/albums", async (c) => {
  if (!(await exists(CACHE_FILE))) return c.json({ albums: [] });
  const albums = JSON.parse(await Deno.readTextFile(CACHE_FILE));
  return c.json({ albums });
});

// Explicit Sync endpoint
app.get("/api/sync", async (c) => {
  const token = await getAccessTokenFromRefresh();
  if (!token) return c.json({ error: "Unauthorized" }, 401);
  const result = await syncLibrary(token);
  const albums = JSON.parse(await Deno.readTextFile(CACHE_FILE));
  return c.json({ ...result, albums });
});

app.get("/api/auth/status", async (c) => {
  const auth = await exists(TOKEN_FILE);
  return c.json({ authenticated: auth });
});

Deno.serve({ port: 8888 }, app.fetch);
