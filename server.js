import express from 'express';
import fetch from 'node-fetch';
import { S3Client, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';

dotenv.config();
const app = express();

const OMDB_API_KEY = process.env.OMDB_API_KEY;

// Storj S3 client
const s3 = new S3Client({
  endpoint: process.env.STORJ_ENDPOINT, // e.g. "https://gateway.storjshare.io"
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.STORJ_ACCESS_KEY,
    secretAccessKey: process.env.STORJ_SECRET_KEY
  }
});
const BUCKET = process.env.STORJ_BUCKET;

function formatYear(yearStr) {
  if (!yearStr) return "";
  if (yearStr.includes("–")) {
    const [start, end] = yearStr.split("–").map(s => s.trim());
    return end ? `${start}–${end}` : start;
  }
  return yearStr;
}

app.get('/api/cache', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  const imdb = req.query.imdb;
  if (!imdb) return res.status(400).json({ error: 'imdb param required' });

  const key = `posters/${imdb}.jpg`;

  try {
    // Check if poster exists in Storj
    try {
      await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
      const url = `${process.env.STORJ_PUBLIC_BASE}/${key}`;
      const year = await fetchYear(imdb);
      return res.json({ posterUrl: url, year });
    } catch (err) {
      // Not found — fetch from OMDb
      const omdbRes = await fetch(`https://www.omdbapi.com/?i=${imdb}&apikey=${OMDB_API_KEY}`);
      const data = await omdbRes.json();
      const year = (data && data.Response !== 'False') ? formatYear(data.Year || '') : '';
      const posterSrc = (data && data.Poster && data.Poster !== 'N/A') ? data.Poster : null;
      if (!posterSrc) return res.json({ posterUrl: null, year });

      const imgRes = await fetch(posterSrc);
      if (!imgRes.ok) return res.json({ posterUrl: null, year });
      const buffer = await imgRes.arrayBuffer();

      // Upload to Storj
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: Buffer.from(buffer),
        ContentType: imgRes.headers.get('content-type') || 'image/jpeg'
      }));

      const url = `${process.env.STORJ_PUBLIC_BASE}/${key}`;
      return res.json({ posterUrl: url, year });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.toString() });
  }
});

async function fetchYear(imdb) {
  try {
    const res = await fetch(`https://www.omdbapi.com/?i=${imdb}&apikey=${OMDB_API_KEY}`);
    const j = await res.json();
    return (j && j.Response !== 'False') ? formatYear(j.Year || '') : '';
  } catch {
    return '';
  }
}

app.listen(3000, () => console.log('Server running on port 3000'));
