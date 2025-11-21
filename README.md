# Hibbett.com SEO & Content Monitor

An automated monitoring tool designed to track SEO health, content changes, and navigation structure for Hibbett.com. This system scrapes target URLs, validates key SEO elements, compares versions to detect changes, and sends email alerts.

## Features

- **Multi-Source Monitoring**: Fetches URLs from a local `urls.txt` file and XML sitemaps.
- **Robust Scraping**: Uses [Scrapfly](https://scrapfly.io/) with retry logic and anti-bot bypass to ensure reliable data retrieval.
- **SEO Validation**: Checks for:
  - HTTP Status Codes (200 OK)
  - Missing or invalid Titles
  - Missing or non-self-referencing Canonical tags
  - Missing or long (>160 chars) Meta Descriptions
  - Missing or multiple H1 tags
- **Change Detection**:
  - **Content**: Detects significant visible content changes (>20% difference).
  - **Metadata**: Tracks changes in Title, H1, and Canonical URLs.
  - **Navigation**: Monitors the main navigation menu for added, removed, or renamed links.
  - **Robots.txt**: Detects any changes to the `robots.txt` file.
- **History & Storage**: Stores page versions in MongoDB for historical comparison.
- **Automated Cleanup**: Automatically removes data older than 30 days to maintain database performance.
- **Email Reporting**: Sends detailed email reports summarizing failures, SEO issues, and detected changes.

## Prerequisites

- **Node.js** (v14 or higher)
- **MongoDB** (running locally or accessible via URI)
- **Scrapfly API Key** (for scraping)
- **Gmail Account** (or SMTP server) for sending notifications

## Installation

1. **Clone the repository**:

   ```bash
   git clone <repository-url>
   cd hibbett-html-monitor
   ```

2. **Install dependencies**:

   ```bash
   npm install
   ```

3. **Configure the project**:
   - **Scrapfly**: Open `index.js` and set your `SCRAPFLY_API_KEY`.
   - **MongoDB**: Open `index.js` and set your `MONGO_URI` (default: `mongodb://localhost:27017/hibbett_monitor`).
   - **Email**: Open `sendEmail.js` and configure the `transporter` with your SMTP settings (e.g., Gmail App Password).

## Usage

1. **Add URLs to monitor**:
   - Edit `urls.txt` and add one URL per line.
   - (Optional) Add sitemap URLs to the `SITEMAP_URLS` array in `index.js`.

2. **Run the monitor**:

   ```bash
   node index.js
   ```

   The script will:
   1. Fetch URLs from `urls.txt` and configured sitemaps.
   2. Scrape each URL.
   3. Validate SEO elements.
   4. Compare with the previous version in MongoDB.
   5. Save the new version.
   6. Send an email report.
   7. Clean up data older than 30 days.

## Project Structure

- `index.js`: Main entry point. Handles URL fetching, scraping, parsing, database operations, and change detection logic.
- `sendEmail.js`: Handles email report generation and sending via Nodemailer.
- `urls.txt`: List of static URLs to monitor.
- `package.json`: Project dependencies and scripts.

## License

[MIT](LICENSE)
