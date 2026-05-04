/**
 * Fetches a public caption transcript for a Dan Martell YouTube video and saves it as .txt.
 *
 * Why two steps: YouTube Data API v3 can list metadata (e.g. channel) with an API key, but
 * downloading caption files for videos you do not own requires OAuth as the channel owner.
 * Public auto/manual captions are read here via timedtext (youtube-transcript).
 *
 * Usage:
 *   YOUTUBE_API_KEY=your_key node scripts/fetch-dan-martell-transcript.js "https://www.youtube.com/watch?v=VIDEO_ID"
 *
 * Env:
 *   YOUTUBE_API_KEY - required (Google Cloud → YouTube Data API v3)
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { YoutubeTranscript } from 'youtube-transcript';

/** Official channel id for youtube.com/@danmartell (verify with videos.list if needed). */
const DAN_MARTELL_CHANNEL_ID = 'UCA-mWX9CvCTVFWRMb9bKc9w';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRANSCRIPTS_DIR = join(__dirname, '..', 'research', 'youtube-transcripts');

function extractVideoId(input) {
  const raw = String(input).trim();
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0];
      if (id) return id;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      const v = u.searchParams.get('v');
      if (v) return v;
      const embed = u.pathname.match(/^\/embed\/([^/?]+)/);
      if (embed) return embed[1];
      const shorts = u.pathname.match(/^\/shorts\/([^/?]+)/);
      if (shorts) return shorts[1];
    }
  } catch {
    // not a URL
  }
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw;
  throw new Error('Could not parse a YouTube video id from input.');
}

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'untitled';
}

async function verifyChannel(videoId, apiKey) {
  const url = new URL('https://www.googleapis.com/youtube/v3/videos');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('id', videoId);
  url.searchParams.set('key', apiKey);

  const res = await fetch(url);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`YouTube Data API error ${res.status}: ${errText}`);
  }
  const data = await res.json();
  const item = data.items?.[0];
  if (!item) throw new Error(`No video found for id ${videoId}.`);
  const channelId = item.snippet?.channelId;
  if (channelId !== DAN_MARTELL_CHANNEL_ID) {
    throw new Error(
      `Video is not from Dan Martell's channel (expected ${DAN_MARTELL_CHANNEL_ID}, got ${channelId}).`
    );
  }
  return { title: item.snippet?.title ?? videoId };
}

async function main() {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.error('Set YOUTUBE_API_KEY to a YouTube Data API v3 key.');
    process.exit(1);
  }

  const urlOrId = process.argv[2];
  if (!urlOrId) {
    console.error('Usage: node scripts/fetch-dan-martell-transcript.js <youtube-url-or-video-id>');
    process.exit(1);
  }

  const videoId = extractVideoId(urlOrId);
  const { title } = await verifyChannel(videoId, apiKey);

  const segments = await YoutubeTranscript.fetchTranscript(videoId);
  const text = segments.map((s) => s.text).join(' ');

  await mkdir(TRANSCRIPTS_DIR, { recursive: true });
  const filename = `${videoId}-${slugify(title)}.txt`;
  const outPath = join(TRANSCRIPTS_DIR, filename);
  const header = `${title}\nhttps://www.youtube.com/watch?v=${videoId}\n\n`;

  await writeFile(outPath, header + text, 'utf8');
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
