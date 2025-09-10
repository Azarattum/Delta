import { it, expect } from "bun:test";
import { join, memory, sink } from "deltaflow";
import { album, artist, attribution, track } from "./schema";

it("joins tracks with albums", async () => {
  const tracks = memory(track);
  const albums = memory(album);
  const library = join(tracks, "album", albums, "id", "albums");

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
    [1, 1],
    track,
  ]);

  albums.push([
    [
      { id: 0, title: "Album A", year: 2000 },
      { id: 1, title: "Album B", year: 2001 },
    ],
    [1, 1],
    album,
  ]);

  await watcher;

  const [data, meta] = library.pull();
  expect(data[0].albums).toBe(data[1].albums);
  expect({ ...meta }).toEqual({ 0: 1, 1: 1, albums: [[1], [1]] } as any);
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
      join(tracks, "album", albums, "id", "albums", true),
      "album",
      join(attributions, "artist", artists, "id", "artists"),
      "album",
      "attributions",
    ),
  );

  tracks.push([
    [
      { id: 0, title: "A", duration: 1, album: 0 },
      { id: 1, title: "B", duration: 2, album: 1 },
    ],
    [1, 1],
    track,
  ]);

  albums.push([
    [
      { id: 0, title: "Album A", year: 2000 },
      { id: 1, title: "Album B", year: 2001 },
    ],
    [1, 1],
    album,
  ]);

  artists.push([
    [
      { id: 0, title: "Artist A", following: true },
      { id: 1, title: "Artist B", following: false },
    ],
    [1, 1],
    artist,
  ]);

  attributions.push([
    [
      { album: 0, artist: 0 },
      { album: 0, artist: 1 },
      { album: 1, artist: 1 },
    ],
    [1, 1, 1],
    attribution,
  ]);

  tracks.push([[{ id: 3, title: "C", duration: 2, album: 1 }], [1], track]);

  const [data, meta] = library.pull();
  expect(data).toEqual([
    {
      id: 0,
      title: "A",
      duration: 1,
      album: 0,
      albums: { id: 0, title: "Album A", year: 2000 },
      attributions: [
        {
          album: 0,
          artist: 0,
          artists: [{ id: 0, title: "Artist A", following: true }],
        },
        {
          album: 0,
          artist: 1,
          artists: [{ id: 1, title: "Artist B", following: false }],
        },
      ],
    },
    {
      id: 1,
      title: "B",
      duration: 2,
      album: 1,
      albums: { id: 1, title: "Album B", year: 2001 },
      attributions: [
        {
          album: 1,
          artist: 1,
          artists: [{ id: 1, title: "Artist B", following: false }],
        },
      ],
    },
    {
      id: 3,
      title: "C",
      duration: 2,
      album: 1,
      albums: { id: 1, title: "Album B", year: 2001 },
      attributions: [
        {
          album: 1,
          artist: 1,
          artists: [{ id: 1, title: "Artist B", following: false }],
        },
      ],
    },
  ]);

  expect(meta).toEqual([1, 1, 1] as any);
  expect(meta["albums"]).toEqual([1, 1, 1]);
  expect(meta.attributions).toEqual([[1, 1], [1], [1]] as any);
  expect(meta.attributions[0].artists).toEqual([[1], [1]]);
  expect(meta.attributions[1].artists).toEqual([[1]]);
  expect(meta.attributions[2].artists).toEqual([[1]]);
});
