# Gallery sound

The app looks for one file here:

```
audio/gallery-sound.mp3
```

Until it exists, the dock's sound button disables itself and its tooltip
says the track is missing. Drop the file in and it works on next reload —
no code change needed.

## Where to get a track

**[Musopen](https://musopen.org/music/)** — public-domain *recordings* of
public-domain works. Filter by **Public Domain**, download the MP3, rename
it to `gallery-sound.mp3`.

Good fits for a gallery: Satie's *Gymnopédies*, Debussy's *Clair de lune*,
Chopin nocturnes, Bach's *Goldberg Variations*.

## The licensing trap

**A public-domain composition is not a public-domain recording.**

Beethoven died in 1827, so the score is free to use. A 2010 Berlin
Philharmonic performance of it is a separate, fully copyrighted work — the
performers and label own that recording for decades. Using it without
permission is infringement even though the music itself is ancient.

Musopen exists specifically to solve this: its public-domain section
provides recordings whose *performance rights* have also been released.
Check each track's licence on its page — Musopen also hosts CC-BY material,
which is free but requires a visible credit.

If you use anything other than public domain, add the credit to the
colophon in `index.html` (bottom-left of the canvas).

## Other safe sources

| Source | Licence | Attribution |
|---|---|---|
| [Musopen](https://musopen.org/) | Public domain / CC | None for PD |
| [Internet Archive](https://archive.org/details/audio) | Varies — check each item | Depends |
| [Free Music Archive](https://freemusicarchive.org/) | CC, varies | Usually yes |
| [Incompetech](https://incompetech.com/) | CC-BY | Yes |

## Format

MP3 is what the code requests. Any length works since it loops, but 2–5
minutes avoids an obvious seam. Keep it under a few MB — it is fetched
only when someone turns the sound on, but it is still a download.
