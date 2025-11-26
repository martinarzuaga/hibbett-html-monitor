const fs = require('fs');
require('dotenv').config();
const { ScrapflyClient, ScrapeConfig } = require('scrapfly-sdk');
const { MongoClient } = require('mongodb');
const cheerio = require('cheerio');
const { sendEmail } = require('./sendEmail');

// Your Scrapfly API key
const SCRAPFLY_API_KEY = process.env.SCRAPFLY_API_KEY;
const scrapfly = new ScrapflyClient({ key: SCRAPFLY_API_KEY });

// MongoDB connection URI & client
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/hibbett_monitor';
const client = new MongoClient(MONGO_URI);

// Read URLs from urls.txt
const urlsFile = 'urls.txt';
let urls = fs.readFileSync(urlsFile, 'utf8')
  .split(/\r?\n/)
  .map(line => line.trim())
  .filter(line => line.length > 0);

// Check for limit argument
const limitArg = process.argv[2];
if (limitArg) {
  const limit = parseInt(limitArg, 10);
  if (!isNaN(limit) && limit > 0) {
    console.log(`Limiting scrape to first ${limit} URLs as requested.`);
    urls = urls.slice(0, limit);
  }
}

// Sitemaps to monitor
const SITEMAP_URLS = [
  // Example: 'https://www.hibbett.com/sitemap_index.xml',
  // 'https://www.hibbett.com/sitemap-store_directory.xml',
];

async function fetchSitemapUrls(sitemapUrls) {
  const extractedUrls = [];
  for (const sitemapUrl of sitemapUrls) {
    try {
      console.log(`Fetching sitemap: ${sitemapUrl}`);
      const scrapeConfig = new ScrapeConfig({
        url: sitemapUrl,
        render_js: false, // Sitemaps are usually static XML
        asp: true,
      });
      const result = await scrapfly.scrape(scrapeConfig);
      const xmlContent = result.result?.content || '';
      
      const $ = cheerio.load(xmlContent, { xmlMode: true });
      $('loc').each((i, elem) => {
        const url = $(elem).text().trim();
        if (url && looksLikeUrl(url)) {
          extractedUrls.push(url);
        }
      });
      console.log(`Found ${extractedUrls.length} URLs in sitemap ${sitemapUrl}`);
    } catch (error) {
      console.error(`Error fetching sitemap ${sitemapUrl}:`, error.message);
    }
  }
  return extractedUrls;
}

// Retry scraper with content validation
async function scrapeWithRetry(targetUrl, maxRetries = 3, delay = 5000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const scrapeConfig = new ScrapeConfig({
        url: targetUrl,
        render_js: true,
        asp: true,
        rendering_wait: 10000,
      });
      const result = await scrapfly.scrape(scrapeConfig);
      const htmlContent = result.result?.content || '';
      
      // Check for 403 status
      if (result.result && result.result.status_code === 403) {
        console.log(`Attempt ${attempt}/${maxRetries}: Got 403 for ${targetUrl}`);
        if (attempt < maxRetries) {
          await new Promise(res => setTimeout(res, delay));
          continue;
        }
        throw new Error('403 Forbidden after retries');
      }

      // Validate HTML content quality
      const validation = isValidHtmlContent(htmlContent, targetUrl);
      if (!validation.valid) {
        console.log(`Attempt ${attempt}/${maxRetries}: Invalid content for ${targetUrl} - ${validation.reason}`);
        if (attempt < maxRetries) {
          await new Promise(res => setTimeout(res, delay));
          continue;
        }
        throw new Error(`Invalid content after ${maxRetries} retries: ${validation.reason}`);
      }

      const statusCode = result.result?.status_code || null;
      console.log(`Successfully scraped ${targetUrl} (${htmlContent.length} characters, status: ${statusCode})`);
      return result;
    } catch (err) {
      console.log(`Attempt ${attempt}/${maxRetries}: Error scraping ${targetUrl} - ${err.message}`);
      if (attempt === maxRetries) throw err;
      await new Promise(res => setTimeout(res, delay));
    }
  }
}

function looksLikeUrl(text) {
  try {
    const url = new URL(text);
    // Only consider it a URL if it has a protocol (http/https)
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidHtmlContent(html, url) {
  // Check if HTML is not empty
  if (!html || html.trim().length === 0) {
    return { valid: false, reason: 'Empty content' };
  }

  // Check minimum content length (should be at least a few KB for real pages)
  if (html.length < 1000) {
    return { valid: false, reason: 'Content too short (less than 1000 characters)' };
  }

  // For robots.txt, basic validation is enough
  if (url.includes('robots.txt')) {
    return { valid: true };
  }

  // Check for basic HTML structure
  const hasHtmlTag = /<html[^>]*>/i.test(html);
  const hasHeadTag = /<head[^>]*>/i.test(html);
  const hasBodyTag = /<body[^>]*>/i.test(html);

  if (!hasHtmlTag || !hasHeadTag || !hasBodyTag) {
    return { valid: false, reason: 'Missing basic HTML structure (html/head/body tags)' };
  }

  // Check for common error indicators
  const hasErrorIndicators = /error|blocked|captcha|access denied/i.test(html.substring(0, 5000));
  if (hasErrorIndicators) {
    return { valid: false, reason: 'Page contains error indicators' };
  }

  return { valid: true };
}

function getVisibleText(html) {
  const $ = cheerio.load(html);
  // Remove script, style, and other non-visible elements
  $('script, style, noscript, iframe, svg').remove();
  return $('body').text().replace(/\s+/g, ' ').trim();
}

function extractNavigationLinks(html, baseUrl) {
  const urlObj = new URL(baseUrl);
  const domain = urlObj.hostname;
  const path = urlObj.pathname;

  // Only check navigation on homepages (root path)
  if (path !== '/' && path !== '') {
    return [];
  }

  const $ = cheerio.load(html);
  const navLinks = [];
  
  let nav;
  if (domain.includes('kidshibbett.com')) {
    // Use the specific selector provided for kidshibbett.com
    // <div class="chakra-modal__body css-bkjnbb" id="chakra-modal--body-:r17:">
    // Using class selector as ID seems dynamic
    nav = $('.chakra-modal__body');
  } else {
    // hibbett.com
    nav = $('#navigation');
  }

  if (!nav || nav.length === 0) {
    return navLinks;
  }
  
  // Extract all links within the navigation
  nav.find('a[href]').each((i, elem) => {
    const href = $(elem).attr('href');
    const text = $(elem).text().trim().replace(/\s+/g, ' ');
    
    if (!href || !text) return;
    
    try {
      // Handle relative URLs
      let fullUrl;
      if (href.startsWith('http://') || href.startsWith('https://')) {
        fullUrl = href;
      } else if (href.startsWith('/')) {
        fullUrl = `https://${domain}${href}`;
      } else {
        return; // Skip other formats
      }
      
      const urlObj = new URL(fullUrl);
      
      // Only track internal links (same domain)
      if (urlObj.hostname === domain) {
        navLinks.push({
          url: fullUrl,
          text: text
        });
      }
    } catch (e) {
      // Skip invalid URLs
    }
  });
  
  return navLinks;
}

function compareNavigationLinks(oldLinks, newLinks) {
  const changes = [];
  
  // Create maps for easy lookup
  const oldMap = new Map(oldLinks.map(link => [link.url, link.text]));
  const newMap = new Map(newLinks.map(link => [link.url, link.text]));
  
  // Find removed links
  const removed = [];
  oldMap.forEach((text, url) => {
    if (!newMap.has(url)) {
      removed.push({ url, text });
    }
  });
  
  // Find added links
  const added = [];
  newMap.forEach((text, url) => {
    if (!oldMap.has(url)) {
      added.push({ url, text });
    }
  });
  
  // Find links with changed text
  const textChanged = [];
  newMap.forEach((newText, url) => {
    if (oldMap.has(url)) {
      const oldText = oldMap.get(url);
      if (oldText !== newText) {
        textChanged.push({ url, oldText, newText });
      }
    }
  });
  
  if (removed.length > 0) {
    changes.push({
      type: 'nav_removed',
      links: removed
    });
  }
  
  if (added.length > 0) {
    changes.push({
      type: 'nav_added',
      links: added
    });
  }
  
  if (textChanged.length > 0) {
    changes.push({
      type: 'nav_text_changed',
      links: textChanged
    });
  }
  
  return changes;
}

function compareVersions(oldPage, newPage) {
  const changes = [];
  const isRobotsTxt = newPage.url && newPage.url.includes('robots.txt');
  
  // For robots.txt, just compare raw content
  if (isRobotsTxt) {
    const oldContent = (oldPage.html || '').trim();
    const newContent = (newPage.html || '').trim();
    
    if (oldContent !== newContent) {
      // Calculate percentage difference
      const oldLength = oldContent.length;
      const newLength = newContent.length;
      const percentDiff = oldLength > 0 ? Math.abs(newLength - oldLength) / oldLength * 100 : 100;
      
      changes.push({
        type: 'robotstxt',
        message: `robots.txt content changed (${percentDiff.toFixed(1)}% difference)`,
        oldContent: oldContent,
        newContent: newContent
      });
    }
    return changes;
  }

  // Compare visible content (20% threshold) for regular pages
  const oldText = getVisibleText(oldPage.html);
  const newText = getVisibleText(newPage.html);
  const oldLength = oldText.length;
  const newLength = newText.length;
  
  if (oldLength > 0) {
    const percentDiff = Math.abs(newLength - oldLength) / oldLength * 100;
    if (percentDiff > 20) {
      changes.push({
        type: 'content',
        message: `${percentDiff.toFixed(1)}% of visible content difference vs previous version`
      });
    }
  }

  // Compare title
  if (oldPage.title !== newPage.title) {
    changes.push({
      type: 'title',
      oldValue: oldPage.title || '(empty)',
      newValue: newPage.title || '(empty)'
    });
  }

  // Compare canonical URL
  if (oldPage.canonical !== newPage.canonical) {
    changes.push({
      type: 'canonical',
      oldValue: oldPage.canonical || '(empty)',
      newValue: newPage.canonical || '(empty)'
    });
  }

  // Compare first H1
  const oldH1 = Array.isArray(oldPage.h1) && oldPage.h1.length > 0 ? oldPage.h1[0] : '';
  const newH1 = Array.isArray(newPage.h1) && newPage.h1.length > 0 ? newPage.h1[0] : '';
  
  if (oldH1 !== newH1) {
    changes.push({
      type: 'h1',
      oldValue: oldH1 || '(empty)',
      newValue: newH1 || '(empty)'
    });
  }

  // Compare navigation links
  const oldNavLinks = extractNavigationLinks(oldPage.html, oldPage.url);
  const newNavLinks = extractNavigationLinks(newPage.html, newPage.url);
  const navChanges = compareNavigationLinks(oldNavLinks, newNavLinks);
  
  if (navChanges.length > 0) {
    navChanges.forEach(navChange => changes.push(navChange));
  }

  return changes;
}

async function getPreviousVersions(urls) {
  const comparisons = [];
  
  const database = client.db('hibbett_monitor');
  const collection = database.collection('pages');

  for (const url of urls) {
    // Get the 2 most recent versions for this URL
    const versions = await collection
      .find({ url: url })
      .sort({ timestamp: -1 })
      .limit(2)
      .toArray();

    if (versions.length === 2) {
      const [newVersion, oldVersion] = versions;
      const changes = compareVersions(oldVersion, newVersion);
      
      if (changes.length > 0) {
        comparisons.push({
          url: url,
          changes: changes
        });
      }
    } else if (versions.length === 1) {
      comparisons.push({
        url: url,
        firstScrape: true
      });
    }
  }

  return comparisons;
}

// Parse HTML and build page object
// function parseHtml(html, filename) {
//   const $ = cheerio.load(html);
//   const canonical = $('link[rel="canonical"]').attr('href') || null;
//   const title = $('title').text() || null;
//   const metaDescription = $('meta[name="description"]').attr('content') || null;
//   const h1Tags = $('h1');

//   return {
//     html,
//     filename,
//     canonical,
//     isCanonicalSelfRef: canonical ? (filename.includes(canonical)) : false,
//     title,
//     hasTitle: !!title,
//     metaDescription,
//     hasMetaDescription: !!metaDescription,
//     h1: h1Tags.first().text() || null,
//     hasH1: h1Tags.length > 0,
//     multipleH1s: h1Tags.length > 1,
//     importedAt: new Date().toISOString(),
//   };
// }

function parseHtml(html, url, timestamp, statusCode = null) {
  // Replace entire logic with the enhanced snippet I gave:
  const $ = cheerio.load(html);

  const title = $('title').first().text().trim();
  const hasTitle = !!title && !looksLikeUrl(title);

  const canonical = $('link[rel="canonical"]').attr('href') || '';
  let isCanonicalSelfRef = false;
  if (canonical) {
    try {
      const canonicalUrl = new URL(canonical).href.replace(/\/$/, '');
      const pageUrl = new URL(url).href.replace(/\/$/, '');
      isCanonicalSelfRef = canonicalUrl === pageUrl;
    } catch (e) {
      isCanonicalSelfRef = false;
    }
  }

  const metaDescription = $('meta[name="description"]').attr('content') || '';
  const hasMetaDescription = !!metaDescription; // Just check if it exists

  const h1tags = $('h1').toArray();
  const hasH1 = h1tags.length === 1;

  return {
    url,
    timestamp,
    statusCode,
    html,
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

async function insertPages(pages) {
  const database = client.db('hibbett_monitor');
  const collection = database.collection('pages');
  const result = await collection.insertMany(pages);
  console.log(`Inserted ${result.insertedCount} pages`);
  return result;
}

async function cleanupOldData(retentionDays = 30) {
  const database = client.db('hibbett_monitor');
  const collection = database.collection('pages');
  
  const date = new Date();
  date.setDate(date.getDate() - retentionDays);
  const cutoffTimestamp = date.toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  
  console.log(`Cleaning up data older than ${retentionDays} days (cutoff: ${cutoffTimestamp})...`);
  
  const result = await collection.deleteMany({
    timestamp: { $lt: cutoffTimestamp }
  });
  
  console.log(`Deleted ${result.deletedCount} old entries.`);
}

(async () => {
  const results = [];

  try {
    // Connect to MongoDB once at the start
    await client.connect();
    console.log('Connected to MongoDB');

    // Fetch URLs from sitemaps
    if (SITEMAP_URLS.length > 0) {
      console.log('Fetching URLs from sitemaps...');
      const sitemapUrls = await fetchSitemapUrls(SITEMAP_URLS);
      if (sitemapUrls.length > 0) {
        console.log(`Found ${sitemapUrls.length} URLs from sitemaps`);
        // Merge and deduplicate
        const allUrls = new Set([...urls, ...sitemapUrls]);
        urls = Array.from(allUrls);
        console.log(`Total unique URLs to monitor: ${urls.length}`);
      }
    }

    for (const targetUrl of urls) {
      try {
        const result = await scrapeWithRetry(targetUrl);
        const htmlContent = result.result?.content || '';
        const statusCode = result.result?.status_code || null;
        const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
        const page = parseHtml(htmlContent, targetUrl, timestamp, statusCode);
        page.url = targetUrl;
        results.push(page);
        console.log(`Successfully processed ${targetUrl}`);

      } catch (err) {
        console.error(`Failed to scrape ${targetUrl} after all retries:`, err.message);
        // Create a failed page object with error flag - don't save to DB
        results.push({ 
          url: targetUrl, 
          error: err.message, 
          scrapeFailed: true,
          timestamp: new Date().toISOString() 
        });
      }
    }

    // Separate successful and failed scrapes
    const successfulPages = results.filter(page => !page.scrapeFailed);
    const failedPages = results.filter(page => page.scrapeFailed);

    if (successfulPages.length > 0) {
      await insertPages(successfulPages);
      console.log(`Inserted ${successfulPages.length} pages to MongoDB`);
    }

    if (failedPages.length > 0) {
      console.log(`\nFailed to scrape ${failedPages.length} URL(s):`);
      failedPages.forEach(page => console.log(`  - ${page.url}: ${page.error}`));
    }
    
    // Get comparisons with previous versions (only for successful scrapes)
    const successfulUrls = successfulPages.map(p => p.url);
    const comparisons = await getPreviousVersions(successfulUrls);
    
    // After scraping and parsing all URLs
    await sendEmail(successfulPages, comparisons, failedPages);
    
    // Cleanup old data
    await cleanupOldData(30);
    
  } catch (error) {
    console.error('Fatal error:', error);
  } finally {
    // Close MongoDB connection at the end
    await client.close();
    console.log('MongoDB connection closed');
  }
})();