/**
 * State Management
 */
let allAlbums = [];
let allPlaylists = [];
let historyCursor = null;
let isSyncing = false;
let searchTimeout;

/**
 * App Initialization & Routing
 */
function init() {
  const urlParams = new URLSearchParams(globalThis.location.search);
  const search = urlParams.get("search");

  if (search) {
    const searchInput = document.getElementById("search-input");
    if (searchInput) searchInput.value = search;
  }

  // Handle URL Hash-based routing
  const route = () => {
    const hash = globalThis.location.hash.replace("#", "");
    const [page, id] = hash.split("/");
    const validPages = ["albums", "playlists", "history"];
    const pageId = validPages.includes(page) ? page : "albums";

    switchPage(pageId, false);

    // Special handling for deep links after view switch
    if (pageId === "albums" && id) renderFilteredAlbums();
    if (pageId === "playlists" && id) checkAndShowPlaylist(id);
  };

  globalThis.addEventListener("popstate", route);
  route();
  checkAuthStatus();
}

async function checkAuthStatus() {
  try {
    const res = await fetch("api/auth/status");
    const { authenticated } = await res.json();
    const syncBtn = document.getElementById("sync-vault-btn");

    if (authenticated) {
      fetchAllData();
      // Auto-sync after load
      setTimeout(syncVault, 500);
    } else {
      syncBtn.textContent = "Connect to Sync";
      syncBtn.onclick = () => (globalThis.location.href = "/login");
    }
  } catch (e) {
    console.error("Auth check failed", e);
  }
}

function fetchAllData() {
  fetchAlbums();
  fetchPlaylists();
  fetchHistory();
}

/**
 * Navigation
 */
function switchPage(pageId, updateHistory = true) {
  // Update UI State
  document.querySelectorAll(".page-view").forEach((v) =>
    v.classList.remove("active")
  );
  document.querySelectorAll(".nav-link").forEach((l) =>
    l.classList.remove("active")
  );

  const targetView = document.getElementById(`${pageId}-view`);
  const targetLink = document.querySelector(`.nav-link[data-page="${pageId}"]`);

  if (targetView) targetView.classList.add("active");
  if (targetLink) targetLink.classList.add("active");

  if (updateHistory) {
    globalThis.history.pushState(null, "", `#${pageId}`);
  }

  // Page Specific Logic
  if (pageId === "history") resetAndFetchHistory();
  if (pageId === "playlists") {
    const [_, id] = globalThis.location.hash.replace("#", "").split("/");
    if (!id) showPlaylistIndex();
  }
}

function showPlaylistIndex() {
  document.getElementById("playlist-index").style.display = "block";
  document.getElementById("playlist-detail").style.display = "none";
}

/**
 * API Fetching
 */
async function fetchAlbums() {
  try {
    const res = await fetch("api/albums");
    const data = await res.json();
    allAlbums = data.albums || [];

    if (allAlbums.length > 0) {
      populateGenreFilter(allAlbums);
      renderFilteredAlbums();
    } else {
      document.getElementById("albums-grid").innerHTML =
        '<div class="empty-state">No records found. Perform a sync.</div>';
    }
  } catch (e) {
    console.error("Album fetch failed", e);
  }
}

async function syncVault() {
  if (isSyncing) return;

  const syncBtn = document.getElementById("sync-vault-btn");
  const syncStatus = document.getElementById("sync-status");

  isSyncing = true;
  syncBtn.disabled = true;
  syncBtn.textContent = "Scanning Archive...";
  syncStatus.style.display = "flex";

  try {
    const res = await fetch("api/sync");
    if (res.status === 401) return (globalThis.location.href = "/login");

    const data = await res.json();
    if (data.status !== "fresh") {
      allAlbums = data.albums || [];
      populateGenreFilter(allAlbums);
      renderFilteredAlbums();
    }
  } catch (e) {
    console.error("Sync failed", e);
  } finally {
    isSyncing = false;
    syncStatus.style.display = "none";
    syncBtn.disabled = false;
    syncBtn.textContent = "Sync collection";
  }
}

async function fetchPlaylists() {
  try {
    const res = await fetch("api/playlists");
    const { items = [] } = await res.json();
    allPlaylists = items;
    renderPlaylists(items);

    // Check if we need to deep link into a playlist
    const [page, id] = globalThis.location.hash.replace("#", "").split("/");
    if (page === "playlists" && id) checkAndShowPlaylist(id);
  } catch (e) {
    console.error("Playlists failed", e);
  }
}

function checkAndShowPlaylist(id) {
  const playlist = allPlaylists.find((p) => p.id === id || p.uri === id);
  if (playlist) fetchPlaylistTracks(playlist);
}

async function fetchPlaylistTracks(playlist) {
  document.getElementById("playlist-index").style.display = "none";
  document.getElementById("playlist-detail").style.display = "block";
  document.getElementById("current-playlist-name").textContent = playlist.name;

  const container = document.getElementById("playlist-tracks");
  container.innerHTML = '<div class="empty-state">Loading tracks...</div>';

  try {
    const res = await fetch(`api/playlists/${playlist.id}/tracks`);
    const { items = [] } = await res.json();
    renderTracks(container, items.map((i) => i.track), { isGrid: true });
  } catch (e) {
    console.error("Tracks failed", e);
  }
}

async function fetchHistory() {
  const container = document.getElementById("history-list");
  const loadMoreBtn = document.getElementById("load-more-history");

  try {
    const url = new URL("api/history", globalThis.location.origin);
    url.searchParams.append("limit", "50");
    if (historyCursor) url.searchParams.append("cursor", historyCursor);

    const res = await fetch(url);
    const { history = [], nextCursor } = await res.json();

    historyCursor = nextCursor;
    renderTracks(container, history, {
      isGrid: true,
      isHistory: true,
      append: true,
    });
    loadMoreBtn.style.display = historyCursor ? "block" : "none";
  } catch (e) {
    console.error("History failed", e);
  }
}

function resetAndFetchHistory() {
  historyCursor = null;
  document.getElementById("history-list").innerHTML = "";
  fetchHistory();
}

/**
 * UI Rendering & Helpers
 */
function renderFilteredAlbums() {
  const query = document.getElementById("search-input").value.toLowerCase();
  const decade = document.getElementById("decade-filter").value;
  const genre = document.getElementById("genre-filter").value;
  const sort = document.getElementById("sort-select").value;

  const filtered = allAlbums.filter((album) => {
    // Deep link override: if URL has an ID, only show that album
    const [page, targetId] = globalThis.location.hash.replace("#", "").split(
      "/",
    );
    if (page === "albums" && targetId) {
      return album.id === targetId || album.uri === targetId;
    }

    let searchPattern = query.toLowerCase().replace(/'/gi, "");
    searchPattern = searchPattern
      .replace(/a/gi, "[aàáâãäåæāăąǎǟǡǻȁȃȧ]")
      .replace(/e/gi, "[eèéêëēĕėęěȅȇȩ]")
      .replace(/i/gi, "[iìíîïĩīĭįǐȉȋ]")
      .replace(/o/gi, "[oòóôõöøōŏőœơǒǫǭȍȏȫȭȯȱ]")
      .replace(/u/gi, "[uùúûüũūŭůűųưǔǖǘǚǜȕȗ]");

    const searchRegex = new RegExp(searchPattern, "i");
    const matchesSearch = !query ||
      searchRegex.test(album.name.toLowerCase().replace(/'/gi, "")) ||
      searchRegex.test(album.artist.toLowerCase().replace(/'/gi, "")) ||
      searchRegex.test(album.year.toLowerCase().replace(/'/gi, "")) ||
      (album.genres &&
        album.genres.some((g) =>
          searchRegex.test(g.toLowerCase().replace(/'/gi, ""))
        ));

    let matchesDecade = true;
    if (decade !== "all") {
      const year = parseInt(album.year);
      if (decade === "older") matchesDecade = year < 1970;
      else {matchesDecade = year >= parseInt(decade) &&
          year < parseInt(decade) + 10;}
    }

    const matchesGenre = genre === "all" ||
      (album.genres && album.genres.includes(genre));

    return matchesSearch && matchesDecade && matchesGenre;
  });

  filtered.sort((a, b) => {
    switch (sort) {
      case "date-asc":
        return new Date(a.full_date) - new Date(b.full_date);
      case "name-asc":
        return a.name.localeCompare(b.name);
      case "artist-asc":
        return a.artist.localeCompare(b.artist);
      case "popularity":
        return b.popularity - a.popularity;
      default:
        return 0;
    }
  });

  renderTracks(document.getElementById("albums-grid"), filtered, {
    isAlbum: true,
  });
  document.getElementById("album-count").textContent = filtered.length;
}

function renderPlaylists(items) {
  const grid = document.getElementById("playlists-grid");
  const template = document.getElementById("playlist-card-template");
  grid.innerHTML = "";

  items.forEach((playlist) => {
    const clone = template.content.cloneNode(true);
    clone.querySelector("img").src = playlist.images?.[0]?.url || "";
    clone.querySelector(".playlist-name").textContent = playlist.name;
    clone.querySelector(".playlist-card").onclick = () => {
      globalThis.location.hash = `playlists/${playlist.id}`;
      fetchPlaylistTracks(playlist);
    };
    grid.appendChild(clone);
  });
}

function renderTracks(container, tracks, options = {}) {
  const { isGrid = false, isHistory = false, append = false, isAlbum = false } =
    options;
  if (!append) container.innerHTML = "";

  const template = document.getElementById("album-card-template");

  tracks.forEach((track) => {
    if (!track) return;
    const clone = template.content.cloneNode(true);
    const card = clone.querySelector(".album-card");
    const img = clone.querySelector("img");

    img.src = track.cover || track.album?.images?.[0]?.url ||
      "https://via.placeholder.com/300?text=No+Cover";
    clone.querySelector(".album-name").textContent = track.name;

    let sub = track.artist || track.artists?.map((a) => a.name).join(", ");
    if (isHistory && track.timestamp) sub += ` • ${timeAgo(track.timestamp)}`;
    clone.querySelector(".album-artist").textContent = sub;

    if (isAlbum) {
      clone.querySelector(".album-year").textContent = track.year;
      clone.querySelector(".genre-list").textContent =
        track.genres?.join(", ") || "No words could ever describe this 🦄";

      card.onclick = (e) => {
        if (e.target.matches(".genre-toggle")) {
          e.preventDefault();
          card.querySelector(".genre-list").classList.toggle("is-visible");
        } else if (e.target.matches("img")) {
          openInSpotify(track.uri || track.link);
        }
      };
    } else {
      clone.querySelector(".album-meta-row")?.remove();
      card.onclick = () =>
        openInSpotify(track.link || track.uri || track.external_urls?.spotify);
    }

    container.appendChild(clone);
  });
}

function openInSpotify(link) {
  if (!link) return;
  let uri = link;
  if (link.startsWith("http")) {
    uri = link.replace("https://open.spotify.com/", "spotify:").replace(
      /\//g,
      ":",
    );
  } else if (!link.startsWith("spotify:")) {
    uri = `spotify:track:${link}`;
  }
  globalThis.location.href = uri;
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.max(1, Math.floor(diff / 60000));
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);

  if (days > 0) return `${days}d ago`;
  if (hrs > 0) return `${hrs}h ago`;
  return `${mins}m ago`;
}

function populateGenreFilter(albums) {
  const select = document.getElementById("genre-filter");
  const genres = [...new Set(albums.flatMap((a) => a.genres || []))].sort();
  select.innerHTML = '<option value="all">All Genres</option>' +
    genres.map((g) =>
      `<option value="${g}">${g.charAt(0).toUpperCase() + g.slice(1)}</option>`
    ).join("");
}

/**
 * Event Listeners
 */
document.querySelectorAll(".nav-link").forEach((l) => {
  l.onclick = (e) => {
    e.preventDefault();
    const page = e.currentTarget.dataset.page;
    if (page) switchPage(page);
  };
});
document.getElementById("back-to-playlists").onclick = showPlaylistIndex;
document.getElementById("load-more-history").onclick = fetchHistory;

const filterInputs = [
  "search-input",
  "decade-filter",
  "genre-filter",
  "sort-select",
];
filterInputs.forEach((id) => {
  document.getElementById(id).onchange = renderFilteredAlbums;
  if (id === "search-input") {
    document.getElementById(id).oninput = () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(renderFilteredAlbums, 300);
    };
  }
});

globalThis.addEventListener("beforeunload", (e) => {
  if (isSyncing) {
    e.preventDefault();
    return (e.returnValue = "");
  }
});

/**
 * Now Playing Loop
 */
async function updateNowPlaying() {
  const banner = document.getElementById("now-playing");
  try {
    const res = await fetch("api/now-playing");
    const data = await res.json();

    if (data.playing) {
      document.getElementById("now-playing-cover").src = data.cover;
      document.getElementById("now-playing-name").textContent = data.name;
      document.getElementById("now-playing-artist").textContent = data.artist;
      banner.style.display = "block";
    } else {
      banner.style.display = "none";
    }
  } catch (e) {
    banner.style.display = "none";
  }
}

// Kickoff
init();
updateNowPlaying();
setInterval(updateNowPlaying, 60000);
