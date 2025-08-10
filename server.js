import express from 'express';
import fetch from 'node-fetch';
import { S3Client, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const app = express();
const OMDB_API_KEY = process.env.OMDB_API_KEY;

const s3 = new S3Client({
  endpoint: process.env.STORJ_ENDPOINT, // e.g. https://gateway.storjshare.io
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.STORJ_ACCESS_KEY,
    secretAccessKey: process.env.STORJ_SECRET_KEY
  }
});

const BUCKET = process.env.STORJ_BUCKET;

app.get('/api/cache', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  const imdbId = req.query.imdb;
  if (!imdbId) return res.status(400).json({ error: 'imdb param required' });

  const key = `posters/${imdbId}.jpg`;

  try {
    // Check if file exists
    try {
      await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
      return res.json({
        posterUrl: `${process.env.STORJ_PUBLIC_BASE}/${key}`,
        year: await getYearFromOMDb(imdbId)
      });
    } catch {
      // File not found → fetch from OMDb
      const omdbRes = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${OMDB_API_KEY}`);
      const omdbData = await omdbRes.json();

      if (!omdbData || omdbData.Response === 'False') {
        return res.json({ posterUrl: null, year: '' });
      }

      const posterUrlFromOMDb = omdbData.Poster && omdbData.Poster !== 'N/A' ? omdbData.Poster : null;
      const yearFormatted = formatYear(omdbData.Year);

      if (!posterUrlFromOMDb) {
        return res.json({ posterUrl: null, year: yearFormatted });
      }

      // Download image from OMDb
      const imgRes = await fetch(posterUrlFromOMDb);
      const buffer = Buffer.from(await imgRes.arrayBuffer());

      // Upload to Storj
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buffer,
        ContentType: imgRes.headers.get('content-type') || 'image/jpeg'
      }));

      return res.json({
        posterUrl: `${process.env.STORJ_PUBLIC_BASE}/${key}`,
        year: yearFormatted
      });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

function formatYear(yearStr) {
  if (!yearStr) return '';
  if (yearStr.includes('–')) {
    const [start, end] = yearStr.split('–').map(s => s.trim());
    return end ? `${start}–${end}` : start;
  }
  return yearStr;
}

async function getYearFromOMDb(imdbId) {
  try {
    const res = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${OMDB_API_KEY}`);
    const j = await res.json();
    return (j && j.Response !== 'False') ? formatYear(j.Year || '') : '';
  } catch {
    return '';
  }
}

app.listen(3000, () => console.log('API running on port 3000'));
