import { album, artist, attribution, track } from "./schema";
import { join, memory, nest, sink } from "deltaflow";
import { it, expect } from "bun:test";

// TODO: migrate to public actions API
import { create } from "deltaflow/datastructure/zset";

it("joins tracks with albums", async () => {
  const tracks = memory(track);
  const albums = memory(album);
  const library = join(tracks, "album", albums, "id", "albums");
  const trackWithAlbums = nest(track, "albums", album);

  const watcher = new Promise<void>((resolve) => {
    const disconnect = library.connect((x) => {
      Promise.resolve(() => expect(x).toEqual(library.pull()));
      disconnect();
      resolve();
    });
  });

  tracks.push([
    [
      { id: 0, title: "A", duration: 1, album: 0 },
      { id: 1, title: "B", duration: 2, album: 0 },
    ],
    [create(track), create(track)],
    track,
  ]);

  albums.push([
    [
      { id: 0, title: "Album A", year: 2000 },
      { id: 1, title: "Album B", year: 2001 },
    ],
    [create(album), create(album)],
    album,
  ]);

  await watcher;

  const [data, meta] = library.pull();
  expect(data[0].albums).toBe(data[1].albums);
  expect({ ...meta }).toEqual({
    0: create(trackWithAlbums),
    1: create(trackWithAlbums),
    albums: [[create(album)], [create(album)]],
  } as any);
  expect(data).toEqual([
    {
      id: 0,
      title: "A",
      duration: 1,
      album: 0,
      albums: [{ id: 0, title: "Album A", year: 2000 }],
    },
    {
      id: 1,
      title: "B",
      duration: 2,
      album: 0,
      albums: [{ id: 0, title: "Album A", year: 2000 }],
    },
  ]);
});

it("represents library correctly", async () => {
  const tracks = memory(track);
  const artists = memory(artist);
  const albums = memory(album);
  const attributions = memory(attribution);

  const library = sink(
    join(
      join(
        tracks,
        "album",
        join(attributions, "artist", artists, "id", "artists", true),
        "album",
        "attributions",
      ),
      "album",
      albums,
      "id",
      "album",
      true,
    ),
  );

  tracks.push([
    [
      { id: 0, title: "A", duration: 1, album: 0 },
      { id: 1, title: "B", duration: 2, album: 1 },
    ],
    [create(track), create(track)],
    track,
  ]);

  albums.push([
    [
      { id: 0, title: "Album A", year: 2000 },
      { id: 1, title: "Album B", year: 2001 },
    ],
    [create(album), create(album)],
    album,
  ]);

  artists.push([
    [
      { id: 0, title: "Artist A", following: true },
      { id: 1, title: "Artist B", following: false },
    ],
    [create(artist), create(artist)],
    artist,
  ]);

  attributions.push([
    [
      { album: 0, artist: 0 },
      { album: 0, artist: 1 },
      { album: 1, artist: 1 },
    ],
    [create(attribution), create(attribution), create(attribution)],
    attribution,
  ]);

  tracks.push([
    [{ id: 3, title: "C", duration: 2, album: 1 }],
    [create(track)],
    track,
  ]);

  const [data, meta] = library.pull();
  expect(data).toEqual([
    {
      id: 0,
      title: "A",
      duration: 1,
      album: { id: 0, title: "Album A", year: 2000 },
      attributions: [
        {
          album: 0,
          artist: 0,
          artists: { id: 0, title: "Artist A", following: true },
        },
        {
          album: 0,
          artist: 1,
          artists: { id: 1, title: "Artist B", following: false },
        },
      ],
    },
    {
      id: 1,
      title: "B",
      duration: 2,
      album: { id: 1, title: "Album B", year: 2001 },
      attributions: [
        {
          album: 1,
          artist: 1,
          artists: { id: 1, title: "Artist B", following: false },
        },
      ],
    },
    {
      id: 3,
      title: "C",
      duration: 2,
      album: { id: 1, title: "Album B", year: 2001 },
      attributions: [
        {
          album: 1,
          artist: 1,
          artists: { id: 1, title: "Artist B", following: false },
        },
      ],
    },
  ]);

  const attributionWithArtist = nest(attribution, "artists", artist, true);
  const trackWithAttributions = nest(
    track,
    "attributions",
    attributionWithArtist,
  );
  const libraryShape = nest(trackWithAttributions, "album", album, true);

  expect(meta).toEqual([
    create(libraryShape),
    create(libraryShape),
    create(libraryShape),
  ] as any);
  expect(meta["album"]).toEqual([create(album), create(album), create(album)]);
  expect(meta.attributions).toEqual([
    [create(attributionWithArtist), create(attributionWithArtist)],
    [create(attributionWithArtist)],
    [create(attributionWithArtist)],
  ]);
  expect(meta.attributions[0]["artists"]).toEqual([
    create(artist),
    create(artist),
  ]);
  expect(meta.attributions[1]["artists"]).toEqual([create(artist)]);
  expect(meta.attributions[2]["artists"]).toEqual([create(artist)]);
});
