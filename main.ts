import { Hono } from "hono";
import { serveStatic } from "hono/deno";
import "@std/dotenv/load";
import { exists } from "@std/fs/exists";

const app = new Hono();

const CLIENT_ID = Deno.env.get("SPOTIFY_CLIENT_ID");
const CLIENT_SECRET = Deno.env.get("SPOTIFY_CLIENT_SECRET");
const REDIRECT_URI = Deno.env.get("SPOTIFY_REDIRECT_URI");

console.log(
  `\n🚀 Server started at ${REDIRECT_URI?.replace("/callback", "")}`,
);
console.log(`🔗 Spotify Redirect URI: ${REDIRECT_URI}\n`);

const TOKEN_FILE = "./.cache/refresh_token";
const CACHE_FILE = "./.cache/albums_cache.json";

interface Album {
  name: string;
  artist: string;
  year: string;
  full_date: string;
  cover: string;
  link: string;
  uri: string;
  genres: string[];
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

async function isCacheFresh(token: string) {
  const apiUrl = "https://api.spotify.com/v1/me/albums?limit=10";
  const res = await fetch(apiUrl, {
    headers: { "Authorization": `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Spotify error");
  const data = await res.json();
  const batch = data.items || [];

  let cached: Album[] = [];
  if (await exists(CACHE_FILE)) {
    cached = JSON.parse(await Deno.readTextFile(CACHE_FILE));
  } else {
    console.log("Cache doesn't exist yet. Aborting...");
    return false;
  }

  // Check if batch matches the cache
  const isMatch = cached.length >= batch.length &&
    batch.every((item: SpotifyAlbumItem, idx: number) =>
      item.album.external_urls.spotify === cached[idx]?.link
    );

  if (isMatch) {
    console.log("Cache matches the newest entries.");
  } else {
    console.log("Cache does not match newest entries, refresh needed.");
  }

  return isMatch;
}

async function checkPartialCache(
  items: Album[],
): Promise<[Album[] | null, string | null]> {
  console.log("Check if there is a sequence of 5 repeated albums");
  try {
    const cached = JSON.parse(await Deno.readTextFile(CACHE_FILE));
    const MATCH_THRESHOLD = 5;
    const MAX_NEW_ITEMS = 45; // items.length is 50, leave buffer for match window

    // Batch size is 50
    for (let i = 0; i < MAX_NEW_ITEMS; i++) {
      const testBatch = items.slice(i, i + MATCH_THRESHOLD);
      const hasMatch = testBatch.every((testItem: Album, idx) => {
        return testItem.uri === cached[idx]?.uri;
      });

      if (hasMatch) {
        console.log(
          `Cache hit at position ${i}, doing incremental update`,
        );
        const newItems = items.slice(0, i);
        const newUris = new Set(newItems.map((i) => i.uri));
        const deduplicatedCache = cached.filter((ci: Album) =>
          !newUris.has(ci.uri)
        );
        const finalItems = [...newItems, ...deduplicatedCache];

        return [finalItems, null];
      }
    }

    return [null, "No partial cache sequence found"];
  } catch (e) {
    return [null, `Cache check failed: ${e instanceof Error ? e.message : e}`];
  }
}

async function syncLibrary(token: string) {
  const apiUrl = "https://api.spotify.com/v1/me/albums?limit=50";

  console.log("🔄 Sync: Downloading all...");
  let all: Album[] = [];
  let nextUrl: string | null = apiUrl;

  while (nextUrl) {
    console.log(`Fetching:`, nextUrl);

    const resp: Response = await fetch(nextUrl, {
      headers: { "Authorization": `Bearer ${token}` },
    });

    if (!resp.ok) {
      console.log("resp not ok");
      break;
    }

    const data = await resp.json();
    if (!data.items) {
      console.log("no data.items");
      break;
    }

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
      uri: i.album.uri,
      genres: genreMap[i.album.artists[0].id] || [],
      popularity: i.album.popularity || 0,
    }));

    // Only check the first page
    if (all.length === 0) {
      const [updated, err] = await checkPartialCache(items);
      if (updated) {
        all = updated;
        break; // from while loop
      } else {
        console.log(`Partial cache check error: ${err}`);
      }
    }

    all = [...all, ...items];
    nextUrl = data.next;
  }

  console.log("Writing to file...");
  await Deno.writeTextFile(CACHE_FILE, JSON.stringify(all));

  return { status: "updated", count: all.length };
}

// Frontend
app.use("/*", serveStatic({ root: "./public" }));

// Cache-only endpoint
app.get("/api/albums", async (c) => {
  if (!(await exists(CACHE_FILE))) return c.json({ albums: [] });
  const albums = JSON.parse(await Deno.readTextFile(CACHE_FILE));
  return c.json({ albums });
});

// Sync endpoint
app.get("/api/sync", async (c) => {
  const forceSync = c.req.query("force") !== undefined;
  const token = await getAccessTokenFromRefresh();
  if (!token) return c.json({ error: "Unauthorized" }, 401);

  const isUpToDate = await isCacheFresh(token);

  if (isUpToDate && !forceSync) {
    return c.json({ status: "fresh" });
  } else {
    const result = await syncLibrary(token);
    const albums = JSON.parse(await Deno.readTextFile(CACHE_FILE));
    return c.json({ ...result, albums });
  }
});

app.get("/api/auth/status", async (c) => {
  const auth = await exists(TOKEN_FILE);
  return c.json({ authenticated: auth });
});

Deno.serve({ port: 8000 }, app.fetch);
