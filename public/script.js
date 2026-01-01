async function checkAuthStatus() {
  const response = await fetch("/api/auth/status");
  const data = await response.json();
  const fetchBtn = document.getElementById("fetch-btn");
  const status = document.getElementById("status");

  if (data.authenticated) {
    fetchBtn.textContent = "Sync Library";
    fetchBtn.classList.add("authenticated");
    status.textContent = "Connected to Spotify. Click to sync.";
    // Auto-fetch if authenticated
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

    renderAlbums(data.albums);
    status.textContent = `Library updated: ${data.albums.length} albums found.`;
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

document.getElementById("fetch-btn").addEventListener("click", async () => {
  const response = await fetch("/api/auth/status");
  const data = await response.json();

  if (!data.authenticated) {
    globalThis.location.href = "/login";
    return;
  }

  fetchAlbums();
});

function renderAlbums(albums) {
  const albumsGrid = document.getElementById("albums-grid");
  const template = document.getElementById("album-card-template");

  albumsGrid.innerHTML = "";

  if (albums.length === 0) {
    albumsGrid.innerHTML =
      '<div class="empty-state">Your Spotify library is empty!</div>';
    return;
  }

  albums.forEach((album, index) => {
    const clone = template.content.cloneNode(true);
    const card = clone.querySelector(".album-card");

    card.style.animationDelay = `${index * 0.05}s`;

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

// Initial check
checkAuthStatus();
