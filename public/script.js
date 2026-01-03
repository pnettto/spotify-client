let allAlbums = [];
let filteredAlbums = [];

function initializeFromUrlParams() {
  const urlParams = new URLSearchParams(globalThis.location.search);

  // Set search input
  const search = urlParams.get("search");
  if (search) {
    document.getElementById("search-input").value = search;
  }
}

async function checkAuthStatus() {
  const response = await fetch("api/auth/status");
  const data = await response.json();
  const syncBtn = document.getElementById("sync-vault-btn");

  if (data.authenticated) {
    fetchAlbums();
    setTimeout(() => {
      syncVault();
    }, 500);
  } else {
    syncBtn.textContent = "Connect to Sync";
  }
}

async function fetchAlbums() {
  const albumsGrid = document.getElementById("albums-grid");

  try {
    const response = await fetch(`api/albums`);
    const data = await response.json();

    allAlbums = data.albums || [];
    updateAlbumCount(allAlbums.length);

    if (allAlbums.length > 0) {
      populateGenreFilter(allAlbums);
      applyFilters();
    } else {
      albumsGrid.innerHTML =
        '<div class="empty-state">No records found. Perform a sync.</div>';
    }
  } catch (error) {
    console.error("Archive fetch failed", error);
  }
}

let isSyncing = false;

async function syncVault() {
  const syncBtn = document.getElementById("sync-vault-btn");
  const syncStatus = document.getElementById("sync-status");

  const authRes = await fetch("api/auth/status");
  const authData = await authRes.json();
  if (!authData.authenticated) {
    globalThis.location.href = "/login";
    return;
  }

  const originalText = syncBtn.textContent;
  syncBtn.disabled = true;
  syncBtn.textContent = "Scanning Archive...";

  isSyncing = true;
  syncStatus.style.display = "flex";

  try {
    const response = await fetch("api/sync");
    const data = await response.json();

    if (response.status === 401) {
      globalThis.location.href = "/login";
      return;
    }

    if (data.status === "fresh") {
      console.log("Collection is up-to-date ✨");
      return;
    }

    allAlbums = data.albums || [];
    updateAlbumCount(allAlbums.length);
    populateGenreFilter(allAlbums);
    applyFilters();
  } catch (e) {
    console.error("Sync interrupted", e);
  } finally {
    isSyncing = false;
    syncStatus.style.display = "none";
    syncBtn.disabled = false;
    syncBtn.textContent = originalText;
  }
}

// Warn user before leaving during sync
globalThis.addEventListener("beforeunload", (e) => {
  if (isSyncing) {
    e.preventDefault();
    e.returnValue = "";
    return "";
  }
});

function updateAlbumCount(count) {
  const badge = document.getElementById("album-count");
  if (badge) badge.textContent = count;
}

function populateGenreFilter(albums) {
  const genreFilter = document.getElementById("genre-filter");
  const genres = new Set();
  albums.forEach((album) => {
    if (album.genres) album.genres.forEach((g) => genres.add(g));
  });

  const sortedGenres = Array.from(genres).sort();
  genreFilter.innerHTML = '<option value="all">All Genres</option>';
  sortedGenres.forEach((genre) => {
    const option = document.createElement("option");
    option.value = genre;
    option.textContent = genre.charAt(0).toUpperCase() + genre.slice(1);
    genreFilter.appendChild(option);
  });
}

function applyFilters() {
  const searchQuery = document.getElementById("search-input").value
    .toLowerCase();
  const decadeFilter = document.getElementById("decade-filter").value;
  const genreFilter = document.getElementById("genre-filter").value;
  const sortSelect = document.getElementById("sort-select").value;

  filteredAlbums = allAlbums.filter((album) => {
    let searchPattern = searchQuery.toLowerCase();
    // Make appostrophes optional
    searchPattern = searchPattern
      .replace(/'/gi, "");
    // Replace base vowels
    searchPattern = searchPattern
      .replace(/a/gi, "[aàáâãäåæāăąǎǟǡǻȁȃȧ]")
      .replace(/e/gi, "[eèéêëēĕėęěȅȇȩ]")
      .replace(/i/gi, "[iìíîïĩīĭįǐȉȋ]")
      .replace(/o/gi, "[oòóôõöøōŏőœơǒǫǭȍȏȫȭȯȱ]")
      .replace(/u/gi, "[uùúûüũūŭůűųưǔǖǘǚǜȕȗ]");
    const searchRegex = new RegExp(searchPattern, "i");
    const matchesSearch =
      searchRegex.test(album.name.toLowerCase().replace(/'/gi, "")) ||
      searchRegex.test(album.artist.toLowerCase().replace(/'/gi, "")) ||
      searchRegex.test(album.year.toLowerCase().replace(/'/gi, "")) ||
      album.genres.some((genre) =>
        searchRegex.test(genre.toLowerCase().replace(/'/gi, ""))
      );

    const albumYear = parseInt(album.year);
    let matchesDecade = true;
    if (decadeFilter !== "all") {
      if (decadeFilter === "older") matchesDecade = albumYear < 1970;
      else {
        const decadeStart = parseInt(decadeFilter);
        matchesDecade = albumYear >= decadeStart &&
          albumYear < decadeStart + 10;
      }
    }

    const matchesGenre = genreFilter === "all" ||
      (album.genres && album.genres.includes(genreFilter));
    return matchesSearch && matchesDecade && matchesGenre;
  });

  filteredAlbums.sort((a, b) => {
    switch (sortSelect) {
      case "none":
        return a;
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

  renderAlbums(filteredAlbums);
}

let searchTimeout;
function debouncedApplyFilters() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    applyFilters();
  }, 500);
}

document.getElementById("sync-vault-btn").addEventListener("click", syncVault);
document.getElementById("search-input").addEventListener(
  "input",
  debouncedApplyFilters,
);
document.getElementById("decade-filter").addEventListener(
  "change",
  applyFilters,
);
document.getElementById("genre-filter").addEventListener(
  "change",
  applyFilters,
);
document.getElementById("sort-select").addEventListener("change", applyFilters);

function renderAlbums(albums) {
  const albumsGrid = document.getElementById("albums-grid");
  const template = document.getElementById("album-card-template");
  albumsGrid.innerHTML = "";

  if (albums.length === 0) {
    albumsGrid.innerHTML =
      '<div class="empty-state">No matching records.</div>';
    return;
  }

  albums.forEach((album) => {
    const clone = template.content.cloneNode(true);
    const card = clone.querySelector(".album-card");
    const img = clone.querySelector("img");

    img.src = album.cover || "https://via.placeholder.com/300?text=No+Cover";
    clone.querySelector(".album-name").textContent = album.name;
    clone.querySelector(".album-artist").textContent = album.artist;
    clone.querySelector(".album-year").textContent = album.year;
    clone.querySelector(".genre-list").textContent = album.genres.length > 0
      ? album.genres.join(", ")
      : "No words could ever describe this 🦄";

    const link = clone.querySelector(".view-link");
    if (link) link.href = album.link;

    // Use a direct click listener on the card instead of an overlay
    card.addEventListener("click", (e) => {
      if (e.target.matches(".genre-toggle")) {
        e.preventDefault();
        card
          .querySelector(".genre-list")
          .classList.toggle("is-visible");
        return;
      }

      if (e.target.matches("img")) {
        const spotifyUri = album.uri ||
          album.link.replace("https://open.spotify.com/", "spotify:").replace(
            /\//g,
            ":",
          );
        globalThis.location.href = spotifyUri;
      }
    });

    albumsGrid.appendChild(clone);
  });

  const badge = document.getElementById("album-count");
  badge.innerHTML = albums.length;
}

initializeFromUrlParams();
checkAuthStatus();
