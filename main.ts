import { Hono } from "hono";
import { serveStatic } from "hono/deno";
import "@std/dotenv/load";
import { exists } from "@std/fs/exists";

/**
 * Configuration & Constants
 */
const CLIENT_ID = Deno.env.get("SPOTIFY_CLIENT_ID");
const CLIENT_SECRET = Deno.env.get("SPOTIFY_CLIENT_SECRET");
const REDIRECT_URI = Deno.env.get("SPOTIFY_REDIRECT_URI");

const TOKEN_FILE = "./.cache/refresh_token";
const CACHE_FILE = "./.cache/albums_cache.json";

const app = new Hono();
const kv = await Deno.openKv();

console.log(`\nServer started at ${REDIRECT_URI?.replace("/callback", "")}`);
console.log(`Spotify Redirect URI: ${REDIRECT_URI}\n`);

/**
 * Types & Interfaces
 */
interface Album {
  name: string;
  artist: string;
  year: string;
  full_date: string;
  cover: string;
  link: string;
  uri: string;
  genres: string[];
  popularity: number;
}

interface SpotifyAlbumItem {
  album: {
    name: string;
    artists: { id: string; name: string }[];
    release_date: string;
    images: { url: string }[];
    external_urls: { spotify: string };
    uri: string;
    popularity: number;
  };
}

/**
 * Helper Functions
 */
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

async function isCacheFresh(token: string) {
  try {
    const apiUrl = "https://api.spotify.com/v1/me/albums?limit=10";
    const res = await fetch(apiUrl, {
      headers: { "Authorization": `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("Spotify error");
    const data = await res.json();
    const batch = data.items || [];

    if (!(await exists(CACHE_FILE))) {
      console.log("Cache doesn't exist yet.");
      return false;
    }

    const cached: Album[] = JSON.parse(await Deno.readTextFile(CACHE_FILE));

    // Check if batch matches the top of the cache
    const isMatch = cached.length >= batch.length &&
      batch.every((item: SpotifyAlbumItem, idx: number) =>
        item.album.external_urls.spotify === cached[idx]?.link
      );

    console.log(
      isMatch ? "Cache matches newest entries." : "Cache refresh needed.",
    );
    return isMatch;
  } catch (e) {
    console.error("Cache freshness check failed:", e);
    return false;
  }
}

async function checkPartialCache(
  items: Album[],
): Promise<[Album[] | null, string | null]> {
  try {
    if (!(await exists(CACHE_FILE))) return [null, "No cache file"];

    const cached: Album[] = JSON.parse(await Deno.readTextFile(CACHE_FILE));
    const MATCH_THRESHOLD = 5;
    const MAX_NEW_ITEMS = 45;

    for (let i = 0; i < MAX_NEW_ITEMS; i++) {
      const testBatch = items.slice(i, i + MATCH_THRESHOLD);
      const hasMatch = testBatch.every((testItem, idx) =>
        testItem.uri === cached[idx]?.uri
      );

      if (hasMatch) {
        console.log(
          `Cache hit at position ${i}, performing incremental update.`,
        );
        const newItems = items.slice(0, i);
        const newUris = new Set(newItems.map((item) => item.uri));
        const deduplicatedCache = cached.filter((ci) => !newUris.has(ci.uri));
        return [[...newItems, ...deduplicatedCache], null];
      }
    }
    return [null, "No partial cache sequence found"];
  } catch (e) {
    return [null, `Cache check failed: ${e instanceof Error ? e.message : e}`];
  }
}

async function syncLibrary(token: string) {
  const apiUrl = "https://api.spotify.com/v1/me/albums?limit=50";
  console.log("Sync: Starting full library download...");

  let all: Album[] = [];
  let nextUrl: string | null = apiUrl;

  while (nextUrl) {
    console.log(`Fetching: ${nextUrl}`);
    const resp = await fetch(nextUrl, {
      headers: { "Authorization": `Bearer ${token}` },
    });

    if (!resp.ok) break;

    const data = await resp.json();
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
        {
          headers: { "Authorization": `Bearer ${token}` },
        },
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
      uri: i.album.uri,
      genres: genreMap[i.album.artists[0].id] || [],
      popularity: i.album.popularity || 0,
    }));

    // Check for incremental sync on the first page
    if (all.length === 0) {
      const [updated] = await checkPartialCache(items);
      if (updated) {
        all = updated;
        break;
      }
    }

    all = [...all, ...items];
    nextUrl = data.next;
  }

  await Deno.writeTextFile(CACHE_FILE, JSON.stringify(all));
  return { status: "updated", count: all.length };
}

/**
 * Auth Routes
 */
app.get("/login", (c) => {
  const scope =
    "user-library-read user-read-currently-playing playlist-read-private playlist-read-collaborative";
  const authUrl = new URL("https://accounts.spotify.com/authorize");
  authUrl.searchParams.append("response_type", "code");
  authUrl.searchParams.append("client_id", CLIENT_ID!);
  authUrl.searchParams.append("scope", scope);
  authUrl.searchParams.append("redirect_uri", REDIRECT_URI!);
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
      redirect_uri: REDIRECT_URI!,
    }),
  });

  const data = await response.json();
  if (data.refresh_token) {
    await Deno.writeTextFile(TOKEN_FILE, data.refresh_token);
    return c.redirect("/");
  }
  return c.text("Authentication failed", 400);
});

app.get("/api/auth/status", async (c) => {
  return c.json({ authenticated: await exists(TOKEN_FILE) });
});

/**
 * Albums & Sync Routes
 */
app.get("/api/albums", async (c) => {
  if (!(await exists(CACHE_FILE))) return c.json({ albums: [] });
  const albums = JSON.parse(await Deno.readTextFile(CACHE_FILE));
  return c.json({ albums });
});

app.get("/api/sync", async (c) => {
  const forceSync = c.req.query("force") !== undefined;
  const token = await getAccessTokenFromRefresh();
  if (!token) return c.json({ error: "Unauthorized" }, 401);

  if (await isCacheFresh(token) && !forceSync) {
    return c.json({ status: "fresh" });
  }

  const result = await syncLibrary(token);
  const albums = JSON.parse(await Deno.readTextFile(CACHE_FILE));
  return c.json({ ...result, albums });
});

/**
 * Now Playing & History Routes
 */
app.get("/api/now-playing", async (c) => {
  const token = await getAccessTokenFromRefresh();
  if (!token) return c.json({ playing: false });

  try {
    const res = await fetch(
      "https://api.spotify.com/v1/me/player/currently-playing",
      {
        headers: { "Authorization": `Bearer ${token}` },
      },
    );

    if (res.status === 204 || res.status > 400) {
      return c.json({ playing: false });
    }

    const data = await res.json();
    if (!data.item) return c.json({ playing: false });

    const currentTrack = {
      name: data.item.name,
      artist: data.item.artists.map((a: { name: string }) => a.name).join(", "),
      album: data.item.album.name,
      cover: data.item.album.images[0]?.url || "",
      link: data.item.external_urls.spotify,
      timestamp: Date.now(),
    };

    // Save to Deno Kv history if different from last recorded track
    const lastKey = ["listening_history", "latest"];
    const lastEntry = await kv.get<typeof currentTrack>(lastKey);

    if (
      !lastEntry.value || lastEntry.value.name !== currentTrack.name ||
      lastEntry.value.artist !== currentTrack.artist
    ) {
      await kv.set(["listening_history", currentTrack.timestamp], currentTrack);
      await kv.set(lastKey, currentTrack);
      console.log(
        `New track recorded: ${currentTrack.name} - ${currentTrack.artist}`,
      );
    }

    return c.json({ playing: true, ...currentTrack });
  } catch (e) {
    console.error("Error fetching now playing:", e);
    return c.json({ playing: false, error: String(e) });
  }
});

app.get("/api/history", async (c) => {
  const limit = parseInt(c.req.query("limit") || "6");
  const cursor = c.req.query("cursor");

  const iter = kv.list({ prefix: ["listening_history"] }, {
    reverse: true,
    limit,
    cursor,
  });
  const history = [];

  for await (const entry of iter) {
    if (entry.key[1] === "latest") continue;
    history.push(entry.value);
  }

  return c.json({ history, nextCursor: iter.cursor || null });
});

/**
 * Playlists Routes
 */
app.get("/api/playlists", async (c) => {
  const token = await getAccessTokenFromRefresh();
  if (!token) return c.json({ error: "Unauthorized" }, 401);

  const res = await fetch("https://api.spotify.com/v1/me/playlists?limit=50", {
    headers: { "Authorization": `Bearer ${token}` },
  });
  return c.json(await res.json());
});

app.get("/api/playlists/:id/tracks", async (c) => {
  const id = c.req.param("id");
  const token = await getAccessTokenFromRefresh();
  if (!token) return c.json({ error: "Unauthorized" }, 401);

  const res = await fetch(
    `https://api.spotify.com/v1/playlists/${id}/tracks?limit=100`,
    {
      headers: { "Authorization": `Bearer ${token}` },
    },
  );
  return c.json(await res.json());
});

/**
 * Static Files & Server Start
 */
app.use("/*", serveStatic({ root: "./public" }));

Deno.serve({ port: 8000 }, app.fetch);
