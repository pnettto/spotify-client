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

interface Album {
  name: string;
  artist: string;
  year: string;
  cover: string;
  link: string;
}

interface SpotifyAlbumItem {
  album: {
    name: string;
    artists: { name: string }[];
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

// 1. Redirect to Spotify Login (Run this once manually to authorize)
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

// 2. Handle Callback and Save Refresh Token
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
    return c.text(
      "Logged in! Your albums are now available at /api/albums and will refresh automatically.",
    );
  }

  return c.text("Authentication failed", 400);
});

// 3. Fetch User's Saved Albums (All Pages)
async function fetchUserAlbums(token: string): Promise<Album[]> {
  let allAlbums: Album[] = [];
  let nextUrl: string | null = "https://api.spotify.com/v1/me/albums?limit=50";

  while (nextUrl) {
    console.log(`📡 Fetching page: ${nextUrl}`);
    const response: Response = await fetch(nextUrl, {
      headers: { "Authorization": `Bearer ${token}` },
    });

    if (!response.ok) {
      console.error(`❌ Failed to fetch page: ${response.statusText}`);
      break;
    }

    const data = await response.json();
    if (!data.items) break;

    const pageItems = data.items.map((item: SpotifyAlbumItem) => ({
      name: item.album.name,
      artist: item.album.artists.map((a) => a.name).join(", "),
      year: item.album.release_date.split("-")[0],
      cover: item.album.images[0]?.url || "",
      link: item.album.external_urls.spotify,
    }));

    allAlbums = [...allAlbums, ...pageItems];
    nextUrl = data.next;
  }

  console.log(`✅ Total albums fetched: ${allAlbums.length}`);
  return allAlbums;
}

// Serve static files
app.use("/*", serveStatic({ root: "./public" }));

// 🚀 API Endpoint (Always returns current albums using background refresh)
app.get("/api/albums", async (c) => {
  try {
    const token = await getAccessTokenFromRefresh();

    if (!token) {
      return c.json(
        { error: "Server not authorized. Visit /login first." },
        401,
      );
    }

    const albums = await fetchUserAlbums(token);
    return c.json({ albums });
  } catch (error) {
    console.error("Spotify API Error:", error);
    return c.json({ error: "Failed to fetch from Spotify" }, 500);
  }
});

app.get("/api/auth/status", async (c) => {
  const authorized = await exists(TOKEN_FILE);
  return c.json({ authenticated: authorized });
});

console.log("Server running on http://localhost:8888");
Deno.serve({ port: 8888 }, app.fetch);
