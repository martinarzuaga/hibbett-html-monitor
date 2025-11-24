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
  let criticalLines = [];
  let minorLines = [];
  let noticeLines = [];

  // 1. Notices: Scraping Failures
  if (failedPages.length > 0) {
    allOk = false;
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
    }

    // Critical: Title, Canonical, Missing H1
    if (!page.hasTitle) criticalIssues.push('Missing or invalid Title');
    if (!page.isCanonicalSelfRef) criticalIssues.push('Canonical tag missing or not self-referencing');
    if (!page.hasH1 && !page.multipleH1s) { // Only strictly missing H1 is critical
      criticalIssues.push('No H1 tag found');
    }

    // Minor: Meta Description, Multiple H1s
    if (!page.hasMetaDescription) {
      minorIssues.push('Meta description missing');
    } else if (page.metaDescription && page.metaDescription.length > 160) {
      minorIssues.push('Meta description longer than 160 characters');
    }
    
    if (page.multipleH1s) {
      minorIssues.push('Multiple H1 tags found');
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
      // Notice: First scrape
      noticeLines.push(`<li><strong>${comparison.url}</strong><br>First scrape, no previous version to compare</li>`);
    } else if (comparison.changes && comparison.changes.length > 0) {
      let criticalChanges = [];
      let minorChanges = [];
      
      comparison.changes.forEach(change => {
        // Critical: Content, Robots.txt, Title, Canonical, H1
        if (change.type === 'content') {
          criticalChanges.push(`${change.message}`);
        } else if (change.type === 'robotstxt') {
          criticalChanges.push(`${change.message}`);
          const oldPreview = change.oldContent.substring(0, 200);
          const newPreview = change.newContent.substring(0, 200);
          criticalChanges.push(`<div style="font-size:0.9em; color:#666; margin-top:5px; background:#f5f5f5; padding:5px;">Previous: ${oldPreview}${change.oldContent.length > 200 ? '...' : ''}<br>Current: ${newPreview}${change.newContent.length > 200 ? '...' : ''}</div>`);
        } else if (change.type === 'title') {
          criticalChanges.push(`Title changed:<br><span style="color:#d9534f">- "${change.oldValue}"</span><br><span style="color:#5cb85c">+ "${change.newValue}"</span>`);
        } else if (change.type === 'canonical') {
          criticalChanges.push(`Canonical URL changed:<br><span style="color:#d9534f">- "${change.oldValue}"</span><br><span style="color:#5cb85c">+ "${change.newValue}"</span>`);
        } else if (change.type === 'h1') {
          criticalChanges.push(`H1 changed:<br><span style="color:#d9534f">- "${change.oldValue}"</span><br><span style="color:#5cb85c">+ "${change.newValue}"</span>`);
        } 
        // Minor: Navigation changes
        else if (change.type === 'nav_removed') {
          let msg = `Navigation links removed (${change.links.length}):<ul style="margin-top:0;">`;
          change.links.forEach(link => msg += `<li>"${link.text}" → ${link.url}</li>`);
          msg += '</ul>';
          minorChanges.push(msg);
        } else if (change.type === 'nav_added') {
          let msg = `Navigation links added (${change.links.length}):<ul style="margin-top:0;">`;
          change.links.forEach(link => msg += `<li>"${link.text}" → ${link.url}</li>`);
          msg += '</ul>';
          minorChanges.push(msg);
        } else if (change.type === 'nav_text_changed') {
          let msg = `Navigation link text changed (${change.links.length}):<ul style="margin-top:0;">`;
          change.links.forEach(link => msg += `<li>${link.url}<br><span style="color:#d9534f">- "${link.oldText}"</span><br><span style="color:#5cb85c">+ "${link.newText}"</span></li>`);
          msg += '</ul>';
          minorChanges.push(msg);
        }
      });
      
      if (criticalChanges.length > 0) {
        allOk = false;
        criticalLines.push(`<li><strong>${comparison.url}</strong><br>${criticalChanges.join('<br>')}</li>`);
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
  
  let subject = 'SEO Monitor - All OK';

  // 1. Critical Issues (Red)
  if (criticalLines.length > 0) {
    htmlReport += `
      <h3 style="color: #d9534f; margin-top: 20px;">🚨 Critical Issues & Changes</h3>
      <p style="font-size: 0.9em; color: #666;">(HTTP Errors, Titles, Canonicals, Missing H1, Source Code, Robots.txt)</p>
      <ul style="background: #fff5f5; border: 1px solid #ebccd1; padding: 15px 15px 15px 30px; border-radius: 4px;">
        ${criticalLines.join('')}
      </ul>
    `;
    subject = 'SEO Monitor - Critical Issues Found';
  }

  // 2. Minor Issues (Orange/Yellow)
  if (minorLines.length > 0) {
    htmlReport += `
      <h3 style="color: #f0ad4e; margin-top: 20px;">⚠️ Minor Issues & Changes</h3>
      <p style="font-size: 0.9em; color: #666;">(Meta Descriptions, Multiple H1s, Navigation Menu)</p>
      <ul style="background: #fcf8e3; border: 1px solid #faebcc; padding: 15px 15px 15px 30px; border-radius: 4px;">
        ${minorLines.join('')}
      </ul>
    `;
    if (!criticalLines.length) subject = 'SEO Monitor - Minor Issues Found';
  }

  // 3. Notices (Blue/Info)
  if (noticeLines.length > 0) {
    htmlReport += `
      <h3 style="color: #5bc0de; margin-top: 20px;">ℹ️ Notices</h3>
      <p style="font-size: 0.9em; color: #666;">(Scraping Failures, First Time Scrapes)</p>
      <ul style="background: #d9edf7; border: 1px solid #bce8f1; padding: 15px 15px 15px 30px; border-radius: 4px;">
        ${noticeLines.join('')}
      </ul>
    `;
    if (!criticalLines.length && !minorLines.length) subject = 'SEO Monitor - Notices';
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
