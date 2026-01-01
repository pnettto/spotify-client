let allAlbums = [];
let filteredAlbums = [];

async function checkAuthStatus() {
  const response = await fetch("/api/auth/status");
  const data = await response.json();
  const fetchBtn = document.getElementById("fetch-btn");
  const status = document.getElementById("status");

  if (data.authenticated) {
    fetchBtn.textContent = "Sync Library";
    fetchBtn.classList.add("authenticated");
    status.textContent = "Connected to Spotify. Click to sync.";
    fetchAlbums();
  } else {
    fetchBtn.textContent = "Login with Spotify";
    fetchBtn.classList.remove("authenticated");
    status.textContent = "Please log in to access your albums.";
  }
  return data.authenticated;
}

async function fetchAlbums() {
  const status = document.getElementById("status");
  const albumsGrid = document.getElementById("albums-grid");
  const fetchBtn = document.getElementById("fetch-btn");

  status.textContent = "Synchronizing your collection...";
  status.style.color = "var(--text-secondary)";
  fetchBtn.disabled = true;
  fetchBtn.style.opacity = "0.5";

  try {
    const response = await fetch(`/api/albums`);
    const data = await response.json();

    if (response.status === 401) {
      globalThis.location.href = "/login";
      return;
    }

    if (!response.ok) {
      throw new Error(data.error || "Failed to fetch albums");
    }

    allAlbums = data.albums;
    populateGenreFilter(allAlbums);
    applyFilters();

    status.textContent = `Library updated: ${allAlbums.length} albums found.`;
    status.style.color = "var(--accent-color)";
  } catch (error) {
    status.textContent = error.message;
    status.style.color = "#ff4444";
    albumsGrid.innerHTML =
      `<div class="empty-state">Unable to sync library. ${error.message}</div>`;
  } finally {
    fetchBtn.disabled = false;
    fetchBtn.style.opacity = "1";
  }
}

function populateGenreFilter(albums) {
  const genreFilter = document.getElementById("genre-filter");
  const genres = new Set();
  albums.forEach((album) => {
    album.genres.forEach((g) => genres.add(g));
  });

  const sortedGenres = Array.from(genres).sort();

  // Clear existing except first
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
      album.artist.toLowerCase().includes(searchQuery);

    const albumYear = parseInt(album.year);
    let matchesDecade = true;
    if (decadeFilter !== "all") {
      if (decadeFilter === "older") {
        matchesDecade = albumYear < 1970;
      } else {
        const decadeStart = parseInt(decadeFilter);
        matchesDecade = albumYear >= decadeStart &&
          albumYear < decadeStart + 10;
      }
    }

    const matchesGenre = genreFilter === "all" ||
      album.genres.includes(genreFilter);

    return matchesSearch && matchesDecade && matchesGenre;
  });

  // Sort
  filteredAlbums.sort((a, b) => {
    switch (sortSelect) {
      case "date-desc":
        return new Date(b.full_date) - new Date(a.full_date);
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

document.getElementById("fetch-btn").addEventListener("click", async () => {
  const auth = await checkAuthStatus();
  if (!auth) globalThis.location.href = "/login";
  else fetchAlbums();
});

// Event listeners for filters
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
      '<div class="empty-state">No albums match your filters.</div>';
    return;
  }

  albums.forEach((album, index) => {
    const clone = template.content.cloneNode(true);
    const card = clone.querySelector(".album-card");

    card.style.animationDelay = `${index * 0.02}s`;

    const img = clone.querySelector("img");
    img.src = album.cover || "https://via.placeholder.com/300?text=No+Cover";
    img.onerror = () => {
      img.src = "https://via.placeholder.com/300?text=No+Cover";
    };

    clone.querySelector(".album-name").textContent = album.name;
    clone.querySelector(".album-artist").textContent = album.artist;
    clone.querySelector(".album-year").textContent = album.year;
    clone.querySelector(".view-link").href = album.link;

    albumsGrid.appendChild(clone);
  });
}

checkAuthStatus();
