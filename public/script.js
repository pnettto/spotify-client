let allAlbums = [];
let filteredAlbums = [];

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

async function syncVault() {
  const syncBtn = document.getElementById("sync-vault-btn");

  const authRes = await fetch("api/auth/status");
  const authData = await authRes.json();
  if (!authData.authenticated) {
    globalThis.location.href = "/login";
    return;
  }

  const originalText = syncBtn.textContent;
  syncBtn.disabled = true;
  syncBtn.textContent = "Scanning Archive...";

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
    syncBtn.disabled = false;
    syncBtn.textContent = originalText;
  }
}

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
    const matchesSearch = album.name.toLowerCase().includes(searchQuery) ||
      album.artist.toLowerCase().includes(searchQuery) ||
      album.genres.some((genre) =>
        genre.toLowerCase().includes(searchQuery.toLowerCase())
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
      default:
        return 0;
    }
  });

  renderAlbums(filteredAlbums);
}

document.getElementById("sync-vault-btn").addEventListener("click", syncVault);
document.getElementById("search-input").addEventListener("input", applyFilters);
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
}

checkAuthStatus();
