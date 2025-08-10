// server.js
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import { S3Client, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const app = express();
app.use(cors());

// ===== ENV VARS (set these in Render dashboard) =====
const OMDB_API_KEY = process.env.OMDB_API_KEY; // Your OMDb API key
const STORJ_ENDPOINT = process.env.STORJ_ENDPOINT; // e.g. https://gateway.storjshare.io
const STORJ_ACCESS_KEY = process.env.STORJ_ACCESS_KEY;
const STORJ_SECRET_KEY = process.env.STORJ_SECRET_KEY;
const STORJ_BUCKET = process.env.STORJ_BUCKET; // e.g. pzp-posters
const STORJ_PUBLIC_BASE = process.env.STORJ_PUBLIC_BASE; // e.g. https://link.storjshare.io/raw/<ACCESS>/<BUCKET>

// ===== INIT S3 CLIENT =====
const s3 = new S3Client({
  endpoint: STORJ_ENDPOINT,
  region: 'us-east-1',
  credentials: {
    accessKeyId: STORJ_ACCESS_KEY,
    secretAccessKey: STORJ_SECRET_KEY
  }
});

// ===== FORMAT YEAR =====
function formatYear(yearStr) {
  if (!yearStr) return '';
  if (yearStr.includes('–')) {
    const [start, end] = yearStr.split('–').map(s => s.trim());
    return end ? `${start}–${end}` : start;
  }
  return yearStr;
}

// ===== GET YEAR ONLY FROM OMDb =====
async function getYearFromOMDb(imdbId) {
  try {
    const res = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${OMDB_API_KEY}`);
    const data = await res.json();
    if (data && data.Response !== 'False') {
      return formatYear(data.Year || '');
    }
    return '';
  } catch (err) {
    console.error('Year fetch error:', err);
    return '';
  }
}

// ===== CACHE API =====
app.get('/api/cache', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');

  const imdbId = req.query.imdb;
  if (!imdbId) return res.status(400).json({ error: 'imdb param required' });

  const key = `posters/${imdbId}.jpg`;

  try {
    // ===== Check if exists in Storj =====
    try {
      await s3.send(new HeadObjectCommand({ Bucket: STORJ_BUCKET, Key: key }));
      const year = await getYearFromOMDb(imdbId);
      return res.json({
        posterUrl: `${STORJ_PUBLIC_BASE}/${key}`,
        year
      });
    } catch {
      // ===== Not in bucket → fetch from OMDb =====
      const omdbRes = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${OMDB_API_KEY}`);
      const data = await omdbRes.json();

      if (!data || data.Response === 'False') {
        return res.json({ posterUrl: null, year: '' });
      }

      const year = formatYear(data.Year || '');
      const posterSrc = (data.Poster && data.Poster !== 'N/A') ? data.Poster : null;

      if (!posterSrc) return res.json({ posterUrl: null, year });

      const imgRes = await fetch(posterSrc);
      if (!imgRes.ok) return res.json({ posterUrl: null, year });

      const buffer = Buffer.from(await imgRes.arrayBuffer());

      await s3.send(new PutObjectCommand({
        Bucket: STORJ_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: imgRes.headers.get('content-type') || 'image/jpeg'
      }));

      return res.json({
        posterUrl: `${STORJ_PUBLIC_BASE}/${key}`,
        year
      });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

// ===== START SERVER =====
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`API running at http://localhost:${port}`);
});
