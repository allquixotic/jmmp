// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import type {
  AlbumListResponse,
  Album,
  Artist,
  ArtistListResponse,
  CatalogUploadRequest,
  FileEntry,
  FileListResponse,
  SearchResponse,
  Track,
  TrackListResponse,
} from "@jmmp/shared";
import { codecFromExtension, type Codec } from "@jmmp/shared";
import type { Database } from "bun:sqlite";
import { fail, get, ok, post, readJson, type Req } from "../router.ts";
import { requireFullSession } from "../session.ts";
import { loadAdapter } from "../sources/index.ts";

interface TrackRow {
  id: number;
  source_id: number;
  source_track_id: string;
  title: string | null;
  artist: string | null;
  album_artist: string | null;
  album: string | null;
  year: number | null;
  track_no: number | null;
  disc_no: number | null;
  duration_ms: number | null;
  codec: string | null;
  sample_rate: number | null;
  bit_depth: number | null;
  channels: number | null;
  file_size: number | null;
  rg_track_db: number | null;
  rg_album_db: number | null;
  art_hash: string | null;
}

type SearchField = "any" | "title" | "artist" | "album";

interface CatalogSearchFilters {
  sourceId: number | null;
  field: SearchField;
}

interface AlbumRow {
  source_id: number;
  album: string;
  artist: string | null;
  album_artist: string | null;
  year: number | null;
  art_hash: string | null;
}

interface ArtistRow {
  source_id: number;
  name: string;
}

function trackFromRow(row: TrackRow): Track {
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceTrackId: row.source_track_id,
    title: row.title ?? "",
    artist: row.artist ?? "",
    albumArtist: row.album_artist ?? undefined,
    album: row.album ?? "",
    year: row.year ?? undefined,
    trackNo: row.track_no ?? undefined,
    discNo: row.disc_no ?? undefined,
    durationMs: row.duration_ms ?? 0,
    codec: (row.codec as Codec) ?? "mp3",
    sampleRate: row.sample_rate ?? undefined,
    bitDepth: row.bit_depth ?? undefined,
    channels: row.channels ?? undefined,
    fileSize: row.file_size ?? undefined,
    rgTrackDb: row.rg_track_db ?? undefined,
    rgAlbumDb: row.rg_album_db ?? undefined,
    artHash: row.art_hash ?? undefined,
  };
}

get("/api/catalog/artists", async (req: Req) => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  const source = req.url.searchParams.get("source");
  const q = req.url.searchParams.get("q");
  const conditions: string[] = ["artist IS NOT NULL", "artist != ''"];
  const params: unknown[] = [];
  if (source) {
    conditions.push("source_id = ?");
    params.push(parseInt(source, 10));
  }
  if (q) {
    conditions.push("artist LIKE ?");
    params.push(`%${q}%`);
  }
  const rows = req.ctx.db
    .query<
      { artist: string; source_id: number; track_count: number },
      typeof params
    >(
      `SELECT artist, source_id, COUNT(*) AS track_count
       FROM tracks
       WHERE ${conditions.join(" AND ")}
       GROUP BY artist, source_id
       ORDER BY artist COLLATE NOCASE`
    )
    .all(...params);
  const body: ArtistListResponse = {
    artists: rows.map((r) => ({
      id: `${r.source_id}::${r.artist}`,
      sourceId: r.source_id,
      name: r.artist,
    })),
  };
  return ok(body);
});

get("/api/catalog/albums", async (req: Req) => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  const artist = req.url.searchParams.get("artist");
  const source = req.url.searchParams.get("source");
  const conditions: string[] = ["album IS NOT NULL", "album != ''"];
  const params: unknown[] = [];
  if (artist) {
    conditions.push("(artist = ? OR album_artist = ?)");
    params.push(artist, artist);
  }
  if (source) {
    conditions.push("source_id = ?");
    params.push(parseInt(source, 10));
  }
  const rows = req.ctx.db
    .query<
      {
        album: string;
        artist: string;
        album_artist: string | null;
        source_id: number;
        year: number | null;
        art_hash: string | null;
      },
      typeof params
    >(
      `SELECT album, MAX(artist) AS artist, MAX(album_artist) AS album_artist,
              source_id, MAX(year) AS year, MAX(art_hash) AS art_hash
       FROM tracks
       WHERE ${conditions.join(" AND ")}
       GROUP BY album, source_id
       ORDER BY album COLLATE NOCASE`
    )
    .all(...params);
  const body: AlbumListResponse = {
    albums: rows.map((r) => ({
      id: `${r.source_id}::${r.album}`,
      sourceId: r.source_id,
      title: r.album,
      artist: r.artist,
      albumArtist: r.album_artist ?? undefined,
      year: r.year ?? undefined,
      artHash: r.art_hash ?? undefined,
    })),
  };
  return ok(body);
});

get("/api/catalog/tracks", async (req: Req) => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  const album = req.url.searchParams.get("album");
  const artist = req.url.searchParams.get("artist");
  const source = req.url.searchParams.get("source");
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (album) {
    conditions.push("album = ?");
    params.push(album);
  }
  if (artist) {
    conditions.push("(artist = ? OR album_artist = ?)");
    params.push(artist, artist);
  }
  if (source) {
    conditions.push("source_id = ?");
    params.push(parseInt(source, 10));
  }
  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const rows = req.ctx.db
    .query<TrackRow, typeof params>(
      `SELECT * FROM tracks ${where}
       ORDER BY disc_no, track_no, title COLLATE NOCASE
       LIMIT 5000`
    )
    .all(...params);
  const body: TrackListResponse = { tracks: rows.map(trackFromRow) };
  return ok(body);
});

get("/api/catalog/search", async (req: Req) => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  const q = req.url.searchParams.get("q") ?? "";
  const sourceParam = req.url.searchParams.get("source");
  const sourceId = sourceParam && sourceParam !== "all" ? parseInt(sourceParam, 10) : null;
  const field = searchField(req.url.searchParams.get("field"));
  if (q.length < 2) {
    const empty: SearchResponse = {
      tracks: [],
      albums: [],
      artists: [],
      fromQobuzLive: false,
    };
    return ok(empty);
  }
  const filters = {
    sourceId: sourceId !== null && Number.isFinite(sourceId) ? sourceId : null,
    field,
  };
  const local = searchLocalCatalog(req.ctx.db, q, filters);
  const tracks = [...local.tracks];
  const seenTrackKeys = new Set(tracks.map(trackResultKey));
  const artistSet = new Map(
    local.artists.map((artist) => [artist.id, artist])
  );
  const albumSet = new Map(local.albums.map((album) => [album.id, album]));

  const qobuz = await searchQobuz(req, q, {
    sourceId: filters.sourceId,
    field,
  });
  for (const t of qobuz.tracks) {
    const upserted = upsertSearchTrack(req, t);
    const key = trackResultKey(upserted);
    if (seenTrackKeys.has(key)) continue;
    seenTrackKeys.add(key);
    tracks.push(upserted);
    if (t.artist)
      artistSet.set(`${t.sourceId}::${t.artist}`, {
        id: `${t.sourceId}::${t.artist}`,
        sourceId: t.sourceId,
        name: t.artist,
      });
    if (t.album)
      albumSet.set(`${t.sourceId}::${t.album}`, {
        id: `${t.sourceId}::${t.album}`,
        sourceId: t.sourceId,
        title: t.album,
        artist: t.artist,
      });
  }
  for (const album of qobuz.albums) albumSet.set(album.id, album);
  for (const artist of qobuz.artists) artistSet.set(artist.id, artist);

  const body: SearchResponse = {
    tracks,
    albums: [...albumSet.values()],
    artists: [...artistSet.values()],
    fromQobuzLive: qobuz.fromQobuzLive,
  };
  return ok(body);
});

export function searchLocalCatalog(
  db: Database,
  query: string,
  filters: CatalogSearchFilters
): { tracks: Track[]; albums: Album[]; artists: Artist[] } {
  const conditions = localSearchConditions(query, filters);
  const rows = db
    .query<TrackRow, unknown[]>(
      `SELECT t.* FROM tracks t
       JOIN tracks_fts f ON f.rowid = t.id
       WHERE ${conditions.sql}
       LIMIT 200`
    )
    .all(...conditions.params);
  const tracks = rows.map(trackFromRow);
  const albumSet = new Map<string, Album>();
  const artistSet = new Map<string, Artist>();

  for (const t of tracks) {
    if (filters.field !== "title") addTrackAlbum(albumSet, t);
    if (filters.field !== "title" && filters.field !== "album") {
      addTrackArtists(artistSet, t);
    }
  }

  for (const album of searchLocalAlbums(db, query, filters)) {
    albumSet.set(album.id, album);
  }
  for (const artist of searchLocalArtists(db, query, filters)) {
    artistSet.set(artist.id, artist);
  }

  return {
    tracks,
    albums: [...albumSet.values()],
    artists: [...artistSet.values()],
  };
}

function searchLocalAlbums(
  db: Database,
  query: string,
  filters: CatalogSearchFilters
): Album[] {
  if (filters.field === "title") return [];
  const conditions = localSearchConditions(query, filters);
  const rows = db
    .query<AlbumRow, unknown[]>(
      `SELECT t.source_id, t.album, MAX(t.artist) AS artist,
              MAX(t.album_artist) AS album_artist, MAX(t.year) AS year,
              MAX(t.art_hash) AS art_hash
       FROM tracks t
       JOIN tracks_fts f ON f.rowid = t.id
       WHERE ${conditions.sql}
         AND t.album IS NOT NULL
         AND t.album != ''
       GROUP BY t.source_id, t.album
       ORDER BY t.album COLLATE NOCASE
       LIMIT 100`
    )
    .all(...conditions.params);
  return rows.map((row) => ({
    id: `${row.source_id}::${row.album}`,
    sourceId: row.source_id,
    title: row.album,
    artist: row.artist ?? row.album_artist ?? "",
    albumArtist: row.album_artist ?? undefined,
    year: row.year ?? undefined,
    artHash: row.art_hash ?? undefined,
  }));
}

function searchLocalArtists(
  db: Database,
  query: string,
  filters: CatalogSearchFilters
): Artist[] {
  if (filters.field === "title" || filters.field === "album") return [];
  const conditions = localSearchConditions(query, filters);
  const rows = db
    .query<ArtistRow, unknown[]>(
      `WITH matched AS (
         SELECT t.source_id, t.artist, t.album_artist
         FROM tracks t
         JOIN tracks_fts f ON f.rowid = t.id
         WHERE ${conditions.sql}
         LIMIT 1000
       ),
       names AS (
         SELECT source_id, artist AS name FROM matched
         UNION
         SELECT source_id, album_artist AS name FROM matched
       )
       SELECT source_id, name
       FROM names
       WHERE name IS NOT NULL
         AND name != ''
       GROUP BY source_id, name
       ORDER BY name COLLATE NOCASE
       LIMIT 100`
    )
    .all(...conditions.params);
  return rows.map((row) => ({
    id: `${row.source_id}::${row.name}`,
    sourceId: row.source_id,
    name: row.name,
  }));
}

function addTrackAlbum(albumSet: Map<string, Album>, track: Track): void {
  if (!track.album) return;
  const id = `${track.sourceId}::${track.album}`;
  if (albumSet.has(id)) return;
  albumSet.set(id, {
    id,
    sourceId: track.sourceId,
    title: track.album,
    artist: track.artist || track.albumArtist || "",
    albumArtist: track.albumArtist,
    year: track.year,
    artHash: track.artHash,
  });
}

function addTrackArtists(artistSet: Map<string, Artist>, track: Track): void {
  for (const name of [track.artist, track.albumArtist]) {
    if (!name) continue;
    const id = `${track.sourceId}::${name}`;
    if (artistSet.has(id)) continue;
    artistSet.set(id, { id, sourceId: track.sourceId, name });
  }
}

function localSearchConditions(
  query: string,
  filters: CatalogSearchFilters
): { sql: string; params: unknown[] } {
  const conditions = ["tracks_fts MATCH ?"];
  const params: unknown[] = [ftsPrefixQuery(query)];
  if (filters.sourceId !== null) {
    conditions.push("t.source_id = ?");
    params.push(filters.sourceId);
  }
  const like = `%${query}%`;
  if (filters.field === "title") {
    conditions.push("t.title LIKE ?");
    params.push(like);
  } else if (filters.field === "artist") {
    conditions.push("(t.artist LIKE ? OR t.album_artist LIKE ?)");
    params.push(like, like);
  } else if (filters.field === "album") {
    conditions.push("t.album LIKE ?");
    params.push(like);
  }
  return { sql: conditions.join(" AND "), params };
}

function ftsPrefixQuery(query: string): string {
  return query
    .split(/\s+/)
    .map((token) => token.replace(/["*]/g, "").trim())
    .filter(Boolean)
    .map((token) => `${token}*`)
    .join(" ");
}

function searchField(value: string | null): SearchField {
  if (value === "title" || value === "artist" || value === "album") return value;
  return "any";
}

function matchesSearchField(t: Track, query: string, field: SearchField): boolean {
  if (field === "any") return true;
  const needle = query.toLocaleLowerCase();
  if (field === "title") return t.title.toLocaleLowerCase().includes(needle);
  if (field === "artist") {
    return (
      t.artist.toLocaleLowerCase().includes(needle) ||
      (t.albumArtist ?? "").toLocaleLowerCase().includes(needle)
    );
  }
  return t.album.toLocaleLowerCase().includes(needle);
}

async function searchQobuz(
  req: Req,
  query: string,
  filters: { sourceId: number | null; field: SearchField }
): Promise<SearchResponse> {
  const where = ["kind = 'qobuz'"];
  const params: unknown[] = [];
  if (filters.sourceId !== null) {
    where.push("id = ?");
    params.push(filters.sourceId);
  }
  const sources = req.ctx.db
    .query<{ id: number }, typeof params>(`SELECT id FROM sources WHERE ${where.join(" AND ")}`)
    .all(...params);
  const combined: SearchResponse = {
    tracks: [],
    albums: [],
    artists: [],
    fromQobuzLive: false,
  };
  for (const source of sources) {
    try {
      const loaded = await loadAdapter(req.ctx.db, req.ctx.machineKey, source.id);
      if (!loaded?.adapter.search) continue;
      const result = await loaded.adapter.search(query, 50);
      combined.fromQobuzLive = true;
      const tracks = result.tracks.filter((track) =>
        matchesSearchField(track, query, filters.field)
      );
      const albums =
        filters.field === "title"
          ? []
          : result.albums.filter((album) =>
              albumMatchesSearchField(album, query, filters.field)
            );
      const artists =
        filters.field === "title" || filters.field === "album"
          ? []
          : result.artists.filter((artist) =>
              filters.field === "any" || filters.field === "artist"
                ? artist.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())
                : true
            );
      combined.albums.push(...albums);
      combined.artists.push(...artists);
      combined.tracks.push(...tracks);
    } catch (err) {
      console.warn(
        `qobuz search failed source=${source.id}:`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }
  return combined;
}

function albumMatchesSearchField(
  album: { title: string; artist: string; albumArtist?: string },
  query: string,
  field: SearchField
): boolean {
  const needle = query.toLocaleLowerCase();
  const title = album.title.toLocaleLowerCase();
  const artist = (album.artist || album.albumArtist || "").toLocaleLowerCase();
  if (field === "album") return title.includes(needle);
  if (field === "artist") return artist.includes(needle);
  return title.includes(needle) || artist.includes(needle);
}

function trackResultKey(t: Pick<Track, "sourceId" | "sourceTrackId">): string {
  return `${t.sourceId}:${t.sourceTrackId}`;
}

function upsertSearchTrack(req: Req, t: Track): Track {
  req.ctx.db
    .query(
      `INSERT INTO tracks (
          source_id, source_track_id, title, artist, album_artist, album, year,
          track_no, disc_no, duration_ms, codec, sample_rate, bit_depth, channels,
          file_size, rg_track_db, rg_album_db, art_hash, last_seen_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
       ON CONFLICT(source_id, source_track_id) DO UPDATE SET
          title=excluded.title, artist=excluded.artist, album_artist=excluded.album_artist,
          album=excluded.album, year=excluded.year, track_no=excluded.track_no,
          disc_no=excluded.disc_no, duration_ms=excluded.duration_ms, codec=excluded.codec,
          sample_rate=excluded.sample_rate, bit_depth=excluded.bit_depth,
          channels=excluded.channels, file_size=excluded.file_size,
          rg_track_db=excluded.rg_track_db, rg_album_db=excluded.rg_album_db,
          art_hash=excluded.art_hash, last_seen_at=unixepoch()`
    )
    .run(
      t.sourceId,
      t.sourceTrackId,
      t.title || null,
      t.artist || null,
      t.albumArtist ?? null,
      t.album || null,
      t.year ?? null,
      t.trackNo ?? null,
      t.discNo ?? null,
      t.durationMs ?? 0,
      t.codec,
      t.sampleRate ?? null,
      t.bitDepth ?? null,
      t.channels ?? null,
      t.fileSize ?? null,
      t.rgTrackDb ?? null,
      t.rgAlbumDb ?? null,
      t.artHash ?? null
    );
  const row = req.ctx.db
    .query<TrackRow, [number, string]>(
      "SELECT * FROM tracks WHERE source_id = ? AND source_track_id = ?"
    )
    .get(t.sourceId, t.sourceTrackId);
  return row ? trackFromRow(row) : t;
}

get("/api/catalog/files", async (req: Req) => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  const source = req.url.searchParams.get("source");
  const path = (req.url.searchParams.get("path") ?? "").replace(/^\//, "");
  if (!source) return fail("source required", 400);
  const sourceId = parseInt(source, 10);
  const prefix = path ? path + "/" : "";

  const rows = req.ctx.db
    .query<{ id: number; source_track_id: string }, [number]>(
      "SELECT id, source_track_id FROM tracks WHERE source_id = ?"
    )
    .all(sourceId);

  const dirs = new Set<string>();
  const files: FileEntry[] = [];
  for (const r of rows) {
    if (!r.source_track_id.startsWith(prefix)) continue;
    const rel = r.source_track_id.slice(prefix.length);
    const slash = rel.indexOf("/");
    if (slash >= 0) {
      dirs.add(rel.slice(0, slash));
    } else {
      files.push({
        path: r.source_track_id,
        name: rel,
        kind: "file",
        trackId: r.id,
      });
    }
  }

  const entries: FileEntry[] = [
    ...[...dirs].sort().map((d) => ({
      path: prefix + d,
      name: d,
      kind: "directory" as const,
    })),
    ...files.sort((a, b) => a.name.localeCompare(b.name)),
  ];

  const body: FileListResponse = { entries, path };
  return ok(body);
});

post("/api/catalog/upload", async (req: Req) => {
  const session = await requireFullSession(req);
  if (session instanceof Response) return session;
  const body = await readJson<CatalogUploadRequest>(req);
  if (!body.sourceId || !Array.isArray(body.tracks)) {
    return fail("sourceId and tracks required", 400);
  }
  const sourceRow = req.ctx.db
    .query<{ kind: string }, [number]>("SELECT kind FROM sources WHERE id = ?")
    .get(body.sourceId);
  if (!sourceRow) return fail("source not found", 404);
  if (sourceRow.kind !== "local") {
    return fail("upload only allowed for local sources", 400);
  }

  const upsert = req.ctx.db.prepare(
    `INSERT INTO tracks (
        source_id, source_track_id, title, artist, album_artist, album, year,
        track_no, disc_no, duration_ms, codec, sample_rate, bit_depth, channels,
        file_size, rg_track_db, rg_album_db, art_hash, mtime, last_seen_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
     ON CONFLICT(source_id, source_track_id) DO UPDATE SET
        title=excluded.title, artist=excluded.artist, album_artist=excluded.album_artist,
        album=excluded.album, year=excluded.year, track_no=excluded.track_no,
        disc_no=excluded.disc_no, duration_ms=excluded.duration_ms, codec=excluded.codec,
        sample_rate=excluded.sample_rate, bit_depth=excluded.bit_depth,
        channels=excluded.channels, file_size=excluded.file_size,
        rg_track_db=excluded.rg_track_db, rg_album_db=excluded.rg_album_db,
        art_hash=excluded.art_hash, mtime=excluded.mtime, last_seen_at=unixepoch()`
  );

  const tx = req.ctx.db.transaction(() => {
    for (const t of body.tracks) {
      const codec = t.codec ?? codecFromExtension(t.sourceTrackId);
      if (!codec) continue;
      upsert.run(
        body.sourceId,
        t.sourceTrackId,
        t.title ?? null,
        t.artist ?? null,
        t.albumArtist ?? null,
        t.album ?? null,
        t.year ?? null,
        t.trackNo ?? null,
        t.discNo ?? null,
        t.durationMs ?? 0,
        codec,
        t.sampleRate ?? null,
        t.bitDepth ?? null,
        t.channels ?? null,
        t.fileSize ?? null,
        t.rgTrackDb ?? null,
        t.rgAlbumDb ?? null,
        t.artHash ?? null,
        Math.floor(Date.now() / 1000)
      );
    }
    if (body.removedSourceTrackIds && body.removedSourceTrackIds.length > 0) {
      const del = req.ctx.db.prepare(
        "DELETE FROM tracks WHERE source_id = ? AND source_track_id = ?"
      );
      for (const stid of body.removedSourceTrackIds) {
        del.run(body.sourceId, stid);
      }
    }
  });
  tx();
  return ok({ accepted: body.tracks.length });
});
