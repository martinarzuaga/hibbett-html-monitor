const nodemailer = require('nodemailer');
require('dotenv').config();

// Setup your SMTP config here
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true, // use SSL
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

function generateReport(pages, comparisons = [], failedPages = []) {
  let allOk = true;
  
  // Section Lines
  let criticalLines = [];
  let sourceChangeLines = [];
  let robotsChangeLines = [];
  let navChangeLines = []; // New array for navigation changes
  let minorLines = [];
  let noticeLines = [];

  // Counters for Summary
  let counts = {
    httpErrors: 0,
    missingTitles: 0,
    missingCanonicals: 0,
    missingH1: 0,
    sourceChanges: 0,
    robotsChanges: 0,
    metaIssues: 0,
    minorTitleIssues: 0,
    minorCanonicalIssues: 0,
    multipleH1: 0,
    navChanges: 0,
    scrapingFailures: 0
  };

  // 1. Notices: Scraping Failures
  if (failedPages.length > 0) {
    allOk = false;
    counts.scrapingFailures = failedPages.length;
    failedPages.forEach(page => {
      noticeLines.push(`<li><strong>${page.url}</strong><br>Scrape failed after 3 retries: ${page.error}</li>`);
    });
  }

  // Process SEO Validation Issues
  pages.forEach(page => {
    const isRobotsTxt = page.url && page.url.includes('robots.txt');
    if (isRobotsTxt) return;

    let criticalIssues = [];
    let minorIssues = [];

    // Critical: HTTP Status
    if (page.statusCode && page.statusCode !== 200) {
      criticalIssues.push(`HTTP Status: ${page.statusCode} (expected 200)`);
      counts.httpErrors++;
    }

    // Critical: Missing Title
    if (!page.hasTitle) {
      criticalIssues.push('Missing or invalid Title');
      counts.missingTitles++;
    } else if (page.title && page.title.length > 60) {
      // Minor: Title too long
      minorIssues.push(`Title too long (${page.title.length} chars): "${page.title}"`);
      counts.minorTitleIssues++;
    }

    // Critical: Missing Canonical
    if (!page.canonical) {
      criticalIssues.push('Canonical tag missing');
      counts.missingCanonicals++;
    } else if (!page.isCanonicalSelfRef) {
      // Minor: Not self-referencing
      minorIssues.push(`Canonical not self-referencing (points to: ${page.canonical})`);
      counts.minorCanonicalIssues++;
    }

    // Critical: Missing H1
    if (!page.hasH1 && !page.multipleH1s) {
      criticalIssues.push('No H1 tag found');
      counts.missingH1++;
    }

    // Minor: Meta Description
    if (!page.hasMetaDescription) {
      minorIssues.push('Meta description missing');
      counts.metaIssues++;
    } else if (page.metaDescription && page.metaDescription.length > 160) {
      minorIssues.push('Meta description longer than 160 characters');
      counts.metaIssues++;
    }
    
    // Minor: Multiple H1s
    if (page.multipleH1s) {
      minorIssues.push('Multiple H1 tags found');
      counts.multipleH1++;
    }

    if (criticalIssues.length > 0) {
      allOk = false;
      criticalLines.push(`<li><strong>${page.url}</strong><br>${criticalIssues.join('<br>')}</li>`);
    }
    
    if (minorIssues.length > 0) {
      allOk = false;
      minorLines.push(`<li><strong>${page.url}</strong><br>${minorIssues.join('<br>')}</li>`);
    }
  });

  // Process Content Changes
  comparisons.forEach(comparison => {
    if (comparison.firstScrape) {
      noticeLines.push(`<li><strong>${comparison.url}</strong><br>First scrape, no previous version to compare</li>`);
    } else if (comparison.changes && comparison.changes.length > 0) {
      let criticalChanges = []; // For Title/H1/Canonical changes (Metadata)
      let minorChanges = []; // For other minor changes
      let navChanges = []; // For Nav changes
      
      comparison.changes.forEach(change => {
        if (change.type === 'content') {
          counts.sourceChanges++;
          sourceChangeLines.push(`<li><strong>${comparison.url}</strong><br>${change.message}</li>`);
        } else if (change.type === 'robotstxt') {
          counts.robotsChanges++;
          const oldPreview = change.oldContent.substring(0, 200);
          const newPreview = change.newContent.substring(0, 200);
          robotsChangeLines.push(`<li><strong>${comparison.url}</strong><br>${change.message}<div style="font-size:0.9em; color:#666; margin-top:5px; background:#f5f5f5; padding:5px;">Previous: ${oldPreview}...<br>Current: ${newPreview}...</div></li>`);
        } else if (change.type === 'title') {
          criticalChanges.push(`Title changed:<br><span style="color:#d9534f">- "${change.oldValue}"</span><br><span style="color:#5cb85c">+ "${change.newValue}"</span>`);
        } else if (change.type === 'canonical') {
          criticalChanges.push(`Canonical URL changed:<br><span style="color:#d9534f">- "${change.oldValue}"</span><br><span style="color:#5cb85c">+ "${change.newValue}"</span>`);
        } else if (change.type === 'h1') {
          criticalChanges.push(`H1 changed:<br><span style="color:#d9534f">- "${change.oldValue}"</span><br><span style="color:#5cb85c">+ "${change.newValue}"</span>`);
        } 
        // Navigation changes
        else if (change.type === 'nav_removed' || change.type === 'nav_added' || change.type === 'nav_text_changed') {
          counts.navChanges++;
          let msg = '';
          if (change.type === 'nav_removed') msg = `Navigation links removed (${change.links.length})`;
          if (change.type === 'nav_added') msg = `Navigation links added (${change.links.length})`;
          if (change.type === 'nav_text_changed') msg = `Navigation link text changed (${change.links.length})`;
          
          msg += ':<ul style="margin-top:0;">';
          change.links.forEach(link => {
            if (change.type === 'nav_text_changed') {
              msg += `<li>${link.url}<br><span style="color:#d9534f">- "${link.oldText}"</span><br><span style="color:#5cb85c">+ "${link.newText}"</span></li>`;
            } else {
              msg += `<li>"${link.text}" → ${link.url}</li>`;
            }
          });
          msg += '</ul>';
          navChanges.push(msg);
        }
      });
      
      if (criticalChanges.length > 0) {
        allOk = false;
        criticalLines.push(`<li><strong>${comparison.url}</strong><br>${criticalChanges.join('<br>')}</li>`);
      }

      if (navChanges.length > 0) {
        allOk = false;
        navChangeLines.push(`<li><strong>${comparison.url}</strong><br>${navChanges.join('<br>')}</li>`);
      }
      
      if (minorChanges.length > 0) {
        allOk = false;
        minorLines.push(`<li><strong>${comparison.url}</strong><br>${minorChanges.join('<br>')}</li>`);
      }
    }
  });

  // Build HTML report
  let htmlReport = `
    <div style="font-family: Arial, sans-serif; color: #333;">
      <h2 style="color: #2c3e50; border-bottom: 2px solid #eee; padding-bottom: 10px;">SEO Monitor Report</h2>
  `;
  
  // Summary Section
  if (!allOk) {
    htmlReport += `<div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 20px; border: 1px solid #e9ecef;">
      <h3 style="margin-top: 0; color: #495057;">📊 Summary</h3>
      <ul style="columns: 2; -webkit-columns: 2; -moz-columns: 2; list-style-type: none; padding: 0; margin: 0;">`;
    
    if (counts.httpErrors > 0) htmlReport += `<li>🔴 HTTP Errors: <strong>${counts.httpErrors}</strong> URLs</li>`;
    if (counts.missingTitles > 0) htmlReport += `<li>🔴 Missing Titles: <strong>${counts.missingTitles}</strong> URLs</li>`;
    if (counts.missingCanonicals > 0) htmlReport += `<li>🔴 Missing Canonicals: <strong>${counts.missingCanonicals}</strong> URLs</li>`;
    if (counts.missingH1 > 0) htmlReport += `<li>🔴 Missing H1: <strong>${counts.missingH1}</strong> URLs</li>`;
    if (counts.sourceChanges > 0) htmlReport += `<li>🟠 Source Code Changes: <strong>${counts.sourceChanges}</strong> URLs</li>`;
    if (counts.robotsChanges > 0) htmlReport += `<li>🟠 Robots.txt Changes: <strong>${counts.robotsChanges}</strong> URLs</li>`;
    if (counts.minorTitleIssues > 0) htmlReport += `<li>🟡 Long Titles: <strong>${counts.minorTitleIssues}</strong> URLs</li>`;
    if (counts.minorCanonicalIssues > 0) htmlReport += `<li>🟡 Non-Self-Ref Canonicals: <strong>${counts.minorCanonicalIssues}</strong> URLs</li>`;
    if (counts.metaIssues > 0) htmlReport += `<li>🟡 Meta Desc Issues: <strong>${counts.metaIssues}</strong> URLs</li>`;
    if (counts.multipleH1 > 0) htmlReport += `<li>🟡 Multiple H1s: <strong>${counts.multipleH1}</strong> URLs</li>`;
    if (counts.navChanges > 0) htmlReport += `<li>🟡 Nav Menu Changes: <strong>${counts.navChanges}</strong> events</li>`;
    if (counts.scrapingFailures > 0) htmlReport += `<li>🔵 Scraping Failures: <strong>${counts.scrapingFailures}</strong> URLs</li>`;
    
    htmlReport += `</ul></div>`;
  }

  let subject = 'SEO Monitor - All OK';

  // 1. Critical Issues (Red)
  if (criticalLines.length > 0) {
    htmlReport += `
      <h3 style="color: #d9534f; margin-top: 20px;">🚨 Critical Issues & Metadata Changes</h3>
      <p style="font-size: 0.9em; color: #666;">(HTTP Errors, Missing Titles, Missing Canonicals, Missing H1)</p>
      <ul style="background: #fff5f5; border: 1px solid #ebccd1; padding: 15px 15px 15px 30px; border-radius: 4px;">
        ${criticalLines.join('')}
      </ul>
    `;
    subject = 'SEO Monitor - Critical Issues Found';
  }

  // 2. Source Code Changes (Orange)
  if (sourceChangeLines.length > 0) {
    htmlReport += `
      <h3 style="color: #e67e22; margin-top: 20px;">📝 Source Code Changes</h3>
      <ul style="background: #fffcf5; border: 1px solid #faebcc; padding: 15px 15px 15px 30px; border-radius: 4px;">
        ${sourceChangeLines.join('')}
      </ul>
    `;
    if (subject === 'SEO Monitor - All OK') subject = 'SEO Monitor - Source Code Changes';
  }

  // 3. Robots.txt Changes (Purple)
  if (robotsChangeLines.length > 0) {
    htmlReport += `
      <h3 style="color: #9b59b6; margin-top: 20px;">🤖 Robots.txt Changes</h3>
      <ul style="background: #fbf5fd; border: 1px solid #e1bee7; padding: 15px 15px 15px 30px; border-radius: 4px;">
        ${robotsChangeLines.join('')}
      </ul>
    `;
    if (subject === 'SEO Monitor - All OK') subject = 'SEO Monitor - Robots.txt Changes';
  }

  // 3.5 Navigation Changes (Blue/Teal)
  if (navChangeLines.length > 0) {
    htmlReport += `
      <h3 style="color: #17a2b8; margin-top: 20px;">🧭 Navigation Menu Changes</h3>
      <ul style="background: #f0f8ff; border: 1px solid #bee5eb; padding: 15px 15px 15px 30px; border-radius: 4px;">
        ${navChangeLines.join('')}
      </ul>
    `;
    if (subject === 'SEO Monitor - All OK') subject = 'SEO Monitor - Navigation Changes';
  }

  // 4. Minor Issues (Yellow)
  if (minorLines.length > 0) {
    htmlReport += `
      <h3 style="color: #f0ad4e; margin-top: 20px;">⚠️ Minor Issues & Changes</h3>
      <p style="font-size: 0.9em; color: #666;">(Meta Descriptions, Long Titles, Non-Self-Ref Canonicals, Multiple H1s)</p>
      <ul style="background: #fcf8e3; border: 1px solid #faebcc; padding: 15px 15px 15px 30px; border-radius: 4px;">
        ${minorLines.join('')}
      </ul>
    `;
    if (subject === 'SEO Monitor - All OK') subject = 'SEO Monitor - Minor Issues Found';
  }

  // 5. Notices (Blue/Info)
  if (noticeLines.length > 0) {
    htmlReport += `
      <h3 style="color: #5bc0de; margin-top: 20px;">ℹ️ Notices</h3>
      <p style="font-size: 0.9em; color: #666;">(Scraping Failures, First Time Scrapes)</p>
      <ul style="background: #d9edf7; border: 1px solid #bce8f1; padding: 15px 15px 15px 30px; border-radius: 4px;">
        ${noticeLines.join('')}
      </ul>
    `;
    if (subject === 'SEO Monitor - All OK') subject = 'SEO Monitor - Notices';
  }

  if (allOk && noticeLines.length === 0) {
    htmlReport += `
      <div style="background: #dff0d8; border: 1px solid #d6e9c6; color: #3c763d; padding: 15px; border-radius: 4px; margin-top: 20px;">
        <strong>✅ All Good!</strong><br>
        All pages passed SEO validation with no content changes detected.
      </div>
    `;
  }

  htmlReport += `
      <div style="margin-top: 30px; font-size: 0.8em; color: #999; border-top: 1px solid #eee; padding-top: 10px;">
        Generated by Hibbett SEO Monitor • ${new Date().toLocaleString()}
      </div>
    </div>
  `;

  return { subject, html: htmlReport };
}

async function sendEmail(pages, comparisons = [], failedPages = []) {
  const report = generateReport(pages, comparisons, failedPages);

  const mailOptions = {
    from: `"SEO Monitor" <${process.env.EMAIL_USER}>`,
    // to: process.env.EMAIL_USER,
    to: 'marzuaga@peakactivity.com, vijaylaxmi.chauhan@hibbett.com, tre.kitchen@hibbett.com, areynolds@peakactivity.com', // Add more emails separated by commas
    subject: report.subject,
    html: report.html, // Use 'html' instead of 'text'
  };

  try {
    let info = await transporter.sendMail(mailOptions);
    console.log('Email sent: %s', info.messageId);
  } catch (error) {
    console.error('Error sending email:', error);
  }
}

module.exports = { sendEmail };
