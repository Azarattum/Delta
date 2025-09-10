import { shape } from "deltaflow";

const RELATION = {
  track2album: 1,
  attribution2album: 2,
  attribution2artist: 3,
};

const track = shape((t) => ({
  id: t(t.INT, t.PRIMARY),
  title: t.STRING,
  duration: t.INT,
  album: t(t.INT, t.RELATION(RELATION.track2album)),
}));

const album = shape((t) => ({
  id: t(
    t.INT,
    t.PRIMARY,
    t.RELATION(RELATION.track2album),
    t.RELATION(RELATION.attribution2album),
  ),
  title: t.STRING,
  year: t.INT,
}));

const artist = shape((t) => ({
  id: t(t.INT, t.PRIMARY, t.RELATION(RELATION.attribution2artist)),
  title: t.STRING,
  following: t.BOOLEAN,
}));

const attribution = shape((t) => ({
  album: t(t.INT, t.PRIMARY, t.RELATION(RELATION.attribution2album)),
  artist: t(t.INT, t.PRIMARY, t.RELATION(RELATION.attribution2artist)),
}));

export { track, artist, album, attribution };
