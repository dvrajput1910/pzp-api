import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors({
  origin: true, // This will reflect the request origin
  credentials: true
}));

const OMDB_API_KEY = process.env.OMDB_API_KEY; // your omdb key
const BUCKET = process.env.STORJ_BUCKET;       // bucket name
const REGION = "us-east-1";
const s3 = new S3Client({
  endpoint: process.env.STORJ_ENDPOINT,  // eg. https://gateway.storjshare.io
  region: REGION,
  credentials: {
    accessKeyId: process.env.STORJ_ACCESS_KEY,
    secretAccessKey: process.env.STORJ_SECRET_KEY
  }
});

async function storjFileExists(key) {
  try {
    const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
    await s3.send(cmd);
    return true;
  } catch {
    return false;
  }
}

async function getSignedPosterUrl(key) {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return await getSignedUrl(s3, cmd, { expiresIn: 60 * 60 });
}

app.get("/api/cache", async (req, res) => {
  const imdbId = req.query.imdb;
  if (!imdbId) return res.status(400).json({ error: "Missing imdb param" });

  try {
    const imgKey = `${imdbId}.jpg`;
    const metaKey = `${imdbId}.json`;

    const hasImage = await storjFileExists(imgKey);
    const hasMeta = await storjFileExists(metaKey);

    if (hasImage && hasMeta) {
      const metaUrl = await getSignedPosterUrl(metaKey);
      const metaResp = await fetch(metaUrl);
      const meta = await metaResp.json();

      const posterUrl = await getSignedPosterUrl(imgKey);
      return res.json({ posterUrl, year: meta.year });
    }

    // fetch from OMDb
    const omdbResp = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${OMDB_API_KEY}`);
    const data = await omdbResp.json();

    if (data.Response === "False") {
      return res.status(404).json({ error: "Movie not found in OMDb" });
    }

    const year = data.Year || "";
    let posterUrl = null;

    if (data.Poster && data.Poster !== "N/A") {
      const posterResp = await fetch(data.Poster);
      const posterBuffer = Buffer.from(await posterResp.arrayBuffer());
      await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: imgKey, Body: posterBuffer, ContentType: "image/jpeg" }));
      posterUrl = await getSignedPosterUrl(imgKey);
    }

    const meta = { year };
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: metaKey, Body: JSON.stringify(meta), ContentType: "application/json" }));

    return res.json({ posterUrl, year });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
app.get("/gist", async (req, res) => {
  const fetch = (await import("node-fetch")).default;
  const gistUrl = "https://gist.githubusercontent.com/dvrajput1910/b98d127bfe384bdc0e3775f04e777ee7/raw/";
  const resp = await fetch(gistUrl);
  const text = await resp.text();
  res.setHeader("Content-Type", "text/plain");
  res.send(text);
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`API running on ${port}`));
