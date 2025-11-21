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
  let reportLines = [];
  let changeLines = [];
  let failedLines = [];

  // Failed scrapes section
  if (failedPages.length > 0) {
    allOk = false;
    failedPages.forEach(page => {
      failedLines.push(`\n• ${page.url}\n  - Scrape failed after 3 retries: ${page.error}\n`);
    });
  }

  // SEO validation section
  pages.forEach(page => {
    const isRobotsTxt = page.url && page.url.includes('robots.txt');
    
    // Skip all SEO checks for robots.txt
    if (isRobotsTxt) {
      return;
    }

    let issues = [];

    // Check status code
    if (page.statusCode && page.statusCode !== 200) {
      issues.push(`HTTP Status: ${page.statusCode} (expected 200)`);
    }

    if (!page.hasTitle) issues.push('Missing or invalid Title');
    if (!page.isCanonicalSelfRef) issues.push('Canonical tag missing or not self-referencing');
    
    // Check meta description existence and length separately
    if (!page.hasMetaDescription) {
      issues.push('Meta description missing');
    } else if (page.metaDescription && page.metaDescription.length > 160) {
      issues.push('Meta description longer than 160 characters');
    }
    
    if (!page.hasH1) {
      issues.push(page.multipleH1s ? 'Multiple H1 tags found' : 'No H1 tag found');
    }

    if (issues.length > 0) {
      allOk = false;
      reportLines.push(`URL: ${page.url}\n  Issues: ${issues.join(', ')}\n`);
    }
  });

  // Content change detection section
  comparisons.forEach(comparison => {
    if (comparison.firstScrape) {
      changeLines.push(`\n• ${comparison.url}\n  - First scrape, no previous version to compare\n`);
    } else if (comparison.changes && comparison.changes.length > 0) {
      let changeDetails = [`\n• ${comparison.url}`];
      
      comparison.changes.forEach(change => {
        if (change.type === 'content') {
          changeDetails.push(`  - ${change.message}`);
        } else if (change.type === 'robotstxt') {
          changeDetails.push(`  - ${change.message}`);
          // Show a preview of changes (first 200 chars of each version)
          const oldPreview = change.oldContent.substring(0, 200);
          const newPreview = change.newContent.substring(0, 200);
          changeDetails.push(`    Previous (preview): ${oldPreview}${change.oldContent.length > 200 ? '...' : ''}`);
          changeDetails.push(`    Current (preview):  ${newPreview}${change.newContent.length > 200 ? '...' : ''}`);
        } else if (change.type === 'title') {
          changeDetails.push(`  - Title changed:`);
          changeDetails.push(`    Previous: "${change.oldValue}"`);
          changeDetails.push(`    Current:  "${change.newValue}"`);
        } else if (change.type === 'canonical') {
          changeDetails.push(`  - Canonical URL changed:`);
          changeDetails.push(`    Previous: "${change.oldValue}"`);
          changeDetails.push(`    Current:  "${change.newValue}"`);
        } else if (change.type === 'h1') {
          changeDetails.push(`  - H1 changed:`);
          changeDetails.push(`    Previous: "${change.oldValue}"`);
          changeDetails.push(`    Current:  "${change.newValue}"`);
        } else if (change.type === 'nav_removed') {
          changeDetails.push(`  - Navigation links removed (${change.links.length}):`);
          change.links.forEach(link => {
            changeDetails.push(`    • "${link.text}" → ${link.url}`);
          });
        } else if (change.type === 'nav_added') {
          changeDetails.push(`  - Navigation links added (${change.links.length}):`);
          change.links.forEach(link => {
            changeDetails.push(`    • "${link.text}" → ${link.url}`);
          });
        } else if (change.type === 'nav_text_changed') {
          changeDetails.push(`  - Navigation link text changed (${change.links.length}):`);
          change.links.forEach(link => {
            changeDetails.push(`    • ${link.url}`);
            changeDetails.push(`      Previous: "${link.oldText}"`);
            changeDetails.push(`      Current:  "${link.newText}"`);
          });
        }
      });
      
      changeLines.push(changeDetails.join('\n') + '\n');
      allOk = false;
    }
  });

  // Build final report
  let finalReport = '';
  let subject = 'SEO Monitor - All OK';

  if (failedLines.length > 0) {
    finalReport += '=== SCRAPING FAILURES ===\n' + failedLines.join('');
    subject = 'SEO Monitor - Scraping Failures';
  }

  if (reportLines.length > 0) {
    if (finalReport) finalReport += '\n\n';
    finalReport += '=== SEO VALIDATION ISSUES ===\n\n' + reportLines.join('\n');
    subject = failedLines.length > 0 ? 'SEO Monitor - Failures & Issues' : 'SEO Monitor - Issues Found';
  }

  if (changeLines.length > 0) {
    if (finalReport) finalReport += '\n\n';
    finalReport += '=== CONTENT CHANGES DETECTED ===\n' + changeLines.join('');
    if (!failedLines.length && !reportLines.length) {
      subject = 'SEO Monitor - Content Changes Detected';
    } else {
      subject = 'SEO Monitor - Multiple Alerts';
    }
  }

  if (finalReport === '') {
    finalReport = 'All pages passed SEO validation with no content changes detected.';
  }

  return { subject, text: finalReport };
}

async function sendEmail(pages, comparisons = [], failedPages = []) {
  const report = generateReport(pages, comparisons, failedPages);

  const mailOptions = {
    from: `"SEO Monitor" <${process.env.EMAIL_USER}>`,
    to: process.env.EMAIL_USER,
    // to: 'marzuaga@peakactivity.com, vijaylaxmi.chauhan@hibbett.com, tre.kitchen@hibbett.com, areynolds@peakactivity.com', // Add more emails separated by commas
    subject: report.subject,
    text: report.text,
  };

  try {
    let info = await transporter.sendMail(mailOptions);
    console.log('Email sent: %s', info.messageId);
  } catch (error) {
    console.error('Error sending email:', error);
  }
}

module.exports = { sendEmail };
