MARVEL JUANJO × MARÍA · V1.13.3
TMDB-only poster correction and mobile image cache release.

Deploy:
1. Keep MARVEL_ROOT_ADMIN_TOKEN as configured in Netlify.
2. Keep TMDB_API_READ_ACCESS_TOKEN as the only media API secret.
3. No Trakt variable is required.
4. Upload this ZIP as the site deploy package.

The release preserves existing title poster mappings except the explicitly repaired titles:
WandaVision, Fantastic Four (2005), I Am Groot, Jessica Jones, Inhumans, Cloak & Dagger, Legion, Hit-Monkey, M.O.D.O.K., Helstrom, and The Punisher: One Last Kill. Marvel One-Shots uses a safe TMDB collection search without fabricating a collection ID.

Poster images are routed through the same-origin Netlify media proxy and Service Worker CacheStorage. The catalog is prewarmed in a capped background pool so the UI starts immediately while poster cache fills.
