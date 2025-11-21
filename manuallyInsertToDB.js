const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { MongoClient } = require('mongodb');

const MONGOURI = 'mongodb://localhost:27017/hibbett_monitor'; // Adjust if needed
const PAGE_SOURCES_DIR = './page_sources'; // Folder with your saved HTML files

const client = new MongoClient(MONGOURI);

function parseHtml(html, url) {
  const $ = cheerio.load(html);
  const title = $('title').first().text().trim();
  const hasTitle = !!title && !looksLikeUrl(title);

  const canonical = $('link[rel="canonical"]').attr('href') || '';
  const isCanonicalSelfRef = canonical ? (new URL(canonical).href === new URL(url).href) : false;

  const metaDescription = $('meta[name="description"]').attr('content') || '';
  const hasMetaDescription = !!metaDescription && metaDescription.length <= 160;

  const h1tags = $('h1').toArray();
  const hasH1 = h1tags.length === 1;

  return {
    title,
    hasTitle,
    canonical,
    isCanonicalSelfRef,
    metaDescription,
    hasMetaDescription,
    h1: h1tags.map(h1 => $(h1).text().trim()),
    hasH1,
    multipleH1s: h1tags.length > 1,
  };
}

function looksLikeUrl(text) {
  try {
    new URL(text);
    return true;
  } catch {
    return false;
  }
}

function extractTimestampFromFilename(filename) {
  // Assumes timestamp right before .html like __YYYYMMDDhhmmss
  const match = filename.match(/__(\d{14})\.html$/);
  return match ? match[1] : null;
}

function formatTimestampDate(ts) {
  // Returns YYYYMMDD string from timestamp YYYYMMDDhhmmss
  return ts ? ts.substring(0,8) : null;
}

async function main() {
  try {
    await client.connect();
    const db = client.db();
    const collection = db.collection('pages');

    const files = fs.readdirSync(PAGE_SOURCES_DIR);
    const todayStr = new Date().toISOString().slice(0,10).replace(/-/g, '');

    for (const file of files) {
      const timestamp = extractTimestampFromFilename(file);
      if (!timestamp) continue;

      const fileDate = formatTimestampDate(timestamp);

      // Only process if fileDate != todayStr
      if (fileDate === todayStr) continue;

      const filepath = path.join(PAGE_SOURCES_DIR, file);
      const html = fs.readFileSync(filepath, 'utf-8');

      // URL extraction logic adapted to your filename pattern
      const urlPart = file.split('__')[0]; // e.g. "www_hibbett_com"
      const url = 'https://' + urlPart.replace(/_/g, '.'); // e.g. "https://www.hibbett.com"

      // Check if already in DB with this URL and timestamp
      const exists = await collection.findOne({ url, timestamp });
      if (exists) continue;

      // Parse SEO data
      const parsed = parseHtml(html, url);

      // Insert document with timestamp and all required fields
      const doc = {
        url,
        html,
        timestamp, // <-- now always included
        ...parsed,
      };

      await collection.insertOne(doc);
      console.log(`Inserted: ${url} (${timestamp})`);
    }
  } catch (err) {
    console.error('Error loading past files:', err);
  } finally {
    await client.close();
  }
}

main();
