#!/usr/bin/env node
/**
 * CanvaFixer - Optimizes Canva HTML email exports for email clients.
 * Targets: Outlook (Word engine), Gmail, iOS Mail, webmail clients.
 * Compatible with Dynamics 365 Customer Insights - Journeys email editor.
 *
 * Usage: node optimize.js input.html [output.html]
 *   If output is omitted, writes to input.optimized.html
 *
 * Rules reference: See memory/email-optimization-rules.md for full details.
 */

const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const inputFile = process.argv[2];
if (!inputFile) {
  console.error("Usage: node optimize.js <input.html> [output.html]");
  process.exit(1);
}

const defaultOutput = inputFile.replace(/(\.\w+)$/, ".optimized$1");
const outputFile = process.argv[3] || defaultOutput;

const raw = fs.readFileSync(inputFile, "utf-8");

// ---------------------------------------------------------------------------
// Counters for reporting
// ---------------------------------------------------------------------------
const stats = {
  // Canva cleanup
  duplicateMobileBlocksRemoved: 0,
  conditionalCommentsRemovedFromBody: 0,
  zeroSizeImages: 0,
  preloadLinksRemoved: 0,
  sesNoTrackRemoved: 0,
  canvaKeywordsMetaRemoved: 0,

  // Style cleanup
  invalidStyleProps: 0,
  negativeBorders: 0,
  redundantBorderRadius: 0,
  alignNull: 0,
  preWrapFixed: 0,
  undefinedMargins: 0,
  minHeightRemoved: 0,
  multilinePaddingFixed: 0,
  marginInlineFixed: 0,
  doubleSemicolonsFixed: 0,
  dataSrcRemoved: 0,

  // Outlook fixes
  fractionalPixelsRounded: 0,
  relativeLineHeightsFixed: 0,
  msoLineHeightRuleAdded: 0,
  imgDisplayBlock: 0,
  imgBorderFixed: 0,
  msoTableSpacing: 0,
  bgcolorMirrored: 0,
  msoParaMarginAdded: 0,
  spacerRowsConsolidated: 0,

  // D365 additions
  d365MetaAdded: 0,
  d365ContainerWrapped: 0,
  msoHeadStylesAdded: 0,
  responsiveStylesAdded: 0,
};

// ---------------------------------------------------------------------------
// Phase 1 - Raw string pre-processing (before DOM parse)
// ---------------------------------------------------------------------------
let html = raw;

// Fix camelCase inline-style properties leaked from React/JS
html = html.replace(
  /\b(marginLeft|marginRight|marginTop|marginBottom)\s*:\s*undefined\s*;?\s*/gi,
  () => { stats.undefinedMargins++; return ""; }
);

// Fix negative border values (invalid CSS)
html = html.replace(
  /border-(top|bottom|left|right)\s*:\s*-[\d.]+px\s+solid\s+#[0-9a-fA-F]+\s*;?\s*/gi,
  () => { stats.negativeBorders++; return ""; }
);

// Fix multi-line padding values (Canva sometimes splits padding across lines)
html = html.replace(
  /padding\s*:\s*([\d.]+px)\s*\n\s*([\d.]+px)\s*\n\s*([\d.]+px)\s*\n\s*([\d.]+px)/gi,
  (_, t, r, b, l) => { stats.multilinePaddingFixed++; return `padding:${t} ${r} ${b} ${l}`; }
);

// Remove conditional comments from body (D365 strips these anyway)
// Keep them in <head> only
html = html.replace(
  /(<body[\s\S]*?)<!--\[if\s+(?:!)?mso\]>[\s\S]*?<!\[endif\]-->/gi,
  (match, prefix) => {
    // Only remove if this is actually inside the body
    if (prefix.includes("<body")) {
      stats.conditionalCommentsRemovedFromBody++;
      return prefix;
    }
    return match;
  }
);
// More targeted: remove <!--[if mso]>...<![endif]--> and <!--[if !mso]><!--> ... <!--<![endif]--> from body
// We do this after DOM parse for accuracy.

// ---------------------------------------------------------------------------
// Phase 2 - DOM-level fixes via cheerio
// ---------------------------------------------------------------------------
const $ = cheerio.load(html, { xml: false, decodeEntities: false });

// ===== 2a. Remove Canva duplicate mobile blocks ============================
// Canva creates pairs: .layout-X (desktop, display:table) and
// .layout-X-under-Y (mobile, display:none with max-width:Ypx media query).
// We keep desktop and remove mobile duplicates for single-source responsive.
$('[class*="-under-"]').each(function () {
  const cls = $(this).attr("class") || "";
  if (/layout-\d+-under-\d+/i.test(cls)) {
    stats.duplicateMobileBlocksRemoved++;
    $(this).remove();
  }
});

// Also remove the associated media query style blocks that reference these
// They appear as <!--[if !mso]><!--><style>@media (max-width:...) { .layout-X-under-Y ... }</style><!--<![endif]-->
// The conditional comment wrappers in head were already handled or will be cleaned below.

// Remove <style> blocks that only contain layout-X/layout-X-under-Y media queries
$("style").each(function () {
  const content = $(this).html() || "";
  // If the style block ONLY has layout show/hide rules, remove it entirely
  if (/^\s*@media[^{]*\{[\s\S]*?layout-\d+(-under-\d+)?[\s\S]*?\}\s*$/i.test(content) &&
      !/[^.#\w-](?!layout-)\w+\s*\{/i.test(content)) {
    $(this).remove();
  }
});

// ===== 2b. Remove conditional comment wrappers from body ===================
// D365 strips these. We handle them as text nodes around style/table elements.
// Cheerio doesn't parse conditional comments well, so we'll handle in Phase 4.

// ===== 2c. Remove <link rel="preload"> ====================================
$('link[rel="preload"]').each(function () {
  $(this).remove();
  stats.preloadLinksRemoved++;
});

// ===== 2d. Remove Canva keywords meta tag ==================================
$('meta[name="keywords"]').each(function () {
  const content = $(this).attr("content") || "";
  // Canva embeds design IDs like "DAHDpQgLzFE, BACyAhU2FKc"
  if (/^[A-Za-z0-9,\s]+$/.test(content) && content.length < 100) {
    $(this).remove();
    stats.canvaKeywordsMetaRemoved++;
  }
});

// ===== 2e. Remove align="null" =============================================
$('[align="null"]').each(function () {
  $(this).removeAttr("align");
  stats.alignNull++;
});

// ===== 2f. Remove zero-size images (Canva mobile placeholders) =============
$("img").each(function () {
  const $img = $(this);
  const w = $img.attr("width");
  const h = $img.attr("height");

  if (w === "0" || h === "0") {
    stats.zeroSizeImages++;
    const $parent = $img.parent("a");
    if ($parent.length && $parent.children().length === 1) {
      $parent.remove();
    } else {
      $img.remove();
    }
  }
});

// ===== 2g. Remove ses:no-track attributes ==================================
$("a").each(function () {
  if ($(this).attr("ses:no-track") !== undefined) {
    $(this).removeAttr("ses:no-track");
    stats.sesNoTrackRemoved++;
  }
});

// ===== 2h. Fix style attributes ============================================
$("[style]").each(function () {
  let style = $(this).attr("style");
  if (!style) return;

  // Remove leftover camelCase properties
  style = style.replace(
    /\b(marginLeft|marginRight|marginTop|marginBottom)\s*:\s*[^;]*;?\s*/gi,
    () => { stats.invalidStyleProps++; return ""; }
  );

  // Remove border-radius: 0 / 0px (adds no value, just bloat)
  style = style.replace(
    /border-(top-left|top-right|bottom-left|bottom-right)-radius\s*:\s*0(px)?\s*;?\s*/gi,
    () => { stats.redundantBorderRadius++; return ""; }
  );
  style = style.replace(/border-radius\s*:\s*0(px)?\s*;?\s*/gi, () => {
    stats.redundantBorderRadius++;
    return "";
  });

  // Replace white-space: pre-wrap (causes issues in many email clients)
  style = style.replace(/white-space\s*:\s*pre-wrap\s*;?\s*/gi, () => {
    stats.preWrapFixed++;
    return "";
  });

  // Remove min-height on wrapper tables (breaks Outlook)
  if ($(this).is("table") && /min-height/i.test(style)) {
    style = style.replace(/min-height\s*:\s*[^;]+;?\s*/gi, () => {
      stats.minHeightRemoved++;
      return "";
    });
  }

  // Fix margin-inline-start (not supported in Outlook)
  style = style.replace(
    /margin-inline-start\s*:\s*([^;]+);?\s*/gi,
    () => { stats.marginInlineFixed++; return ""; }
  );

  // Round fractional pixel values:
  // - font-size, line-height, height, padding, width → nearest multiple of 4
  // - border widths → nearest integer (don't over-round small borders)
  style = style.replace(
    /([\w-]*)\s*:\s*([^;]*?)([\d]*\.[\d]+)px/g,
    (match, prop, prefix, num) => {
      const val = parseFloat(num);
      const isBorder = /border/i.test(prop);
      let rounded;
      if (isBorder) {
        // Borders: round to nearest integer only
        rounded = Math.round(val);
      } else {
        // Everything else: round to nearest multiple of 4
        rounded = Math.round(val / 4) * 4;
      }
      // Don't round non-zero values to 0
      const final = rounded === 0 && val > 0 ? (isBorder ? 1 : 4) : rounded;
      if (final !== val) {
        stats.fractionalPixelsRounded++;
      }
      return `${prop}:${prefix}${final}px`;
    }
  );

  // Also round non-fractional odd pixel values in font-size and line-height to nearest mult of 4
  style = style.replace(
    /(font-size|line-height)\s*:\s*(\d+)px/gi,
    (match, prop, num) => {
      const val = parseInt(num, 10);
      const rounded = Math.round(val / 4) * 4;
      const final = rounded === 0 && val > 0 ? 4 : rounded;
      if (final !== val) {
        stats.fractionalPixelsRounded++;
        return `${prop}:${final}px`;
      }
      return match;
    }
  );

  // Convert relative line-heights to fixed pixel values
  // e.g. line-height:1.4 with font-size:16px → line-height:24px
  style = style.replace(
    /line-height\s*:\s*([\d.]+)\s*(?:;|$)/gi,
    (match, val) => {
      const num = parseFloat(val);
      // Only convert if it looks like a relative value (< 5, not in px/em/%)
      if (num > 0 && num < 5 && !match.includes("px") && !match.includes("em") && !match.includes("%")) {
        // Try to find font-size in same style string
        const fsMatch = style.match(/font-size\s*:\s*(\d+)px/i);
        const fontSize = fsMatch ? parseInt(fsMatch[1], 10) : 16;
        let computed = Math.round(fontSize * num);
        // Round to nearest multiple of 4
        computed = Math.round(computed / 4) * 4;
        if (computed === 0) computed = 4;
        stats.relativeLineHeightsFixed++;
        return `line-height:${computed}px${match.endsWith(";") ? ";" : ""}`;
      }
      return match;
    }
  );

  // Clean up double/trailing semicolons from removals
  style = style.replace(/;\s*;/g, () => { stats.doubleSemicolonsFixed++; return ";"; });
  style = style.replace(/;\s*$/, "").replace(/^\s*;/, "").trim();

  if (style) {
    $(this).attr("style", style);
  } else {
    $(this).removeAttr("style");
  }
});

// ===== 2i. Fix images ======================================================
$("img").each(function () {
  const $img = $(this);
  let style = $img.attr("style") || "";

  // Ensure display:block on all images (prevents gaps in Outlook/Gmail)
  if (!/display\s*:\s*block/i.test(style)) {
    stats.imgDisplayBlock++;
    style = "display:block;" + style;
  }

  // Ensure max-width:100% on all images (prevents overflow on mobile)
  if (!/max-width/i.test(style)) {
    style += ";max-width:100%";
  }

  // Ensure height:auto for fluid scaling
  if (!/height\s*:\s*auto/i.test(style)) {
    style = style.replace(/height\s*:\s*\d+[^;]*;?\s*/gi, "");
    style += ";height:auto";
  }

  // Round image width/height attributes to multiples of 4
  const w = $img.attr("width");
  const h = $img.attr("height");
  if (w) {
    const wVal = parseInt(w, 10);
    if (!isNaN(wVal) && wVal > 0) {
      const rounded = Math.round(wVal / 4) * 4 || 4;
      if (rounded !== wVal) {
        $img.attr("width", String(rounded));
        stats.fractionalPixelsRounded++;
      }
    }
  }
  if (h) {
    const hVal = parseInt(h, 10);
    if (!isNaN(hVal) && hVal > 0) {
      const rounded = Math.round(hVal / 4) * 4 || 4;
      if (rounded !== hVal) {
        $img.attr("height", String(rounded));
        stats.fractionalPixelsRounded++;
      }
    }
  }

  // Add missing alt text
  if (!$img.attr("alt") && $img.attr("alt") !== "") {
    $img.attr("alt", "");
  }

  // Ensure border:0 for linked images + Outlook phantom underline fix
  if ($img.closest("a").length) {
    $img.attr("border", "0");
    if (!/border\s*:/i.test(style)) {
      stats.imgBorderFixed++;
      style += ";border:0";
    }

    const $a = $img.closest("a");
    let aStyle = $a.attr("style") || "";
    if (!/text-decoration/i.test(aStyle)) aStyle += ";text-decoration:none";
    aStyle = aStyle.replace(/^;/, "").replace(/;\s*;/g, ";");
    $a.attr("style", aStyle);
  }

  // Clean up
  style = style.replace(/;\s*;/g, ";").replace(/;\s*$/, "").replace(/^\s*;/, "").trim();
  $img.attr("style", style);

  // Remove data-src (not used by email clients)
  if ($img.attr("data-src")) {
    stats.dataSrcRemoved++;
    $img.removeAttr("data-src");
  }
});

// ===== 2j. Add MSO table spacing to all tables ============================
$("table").each(function () {
  let style = $(this).attr("style") || "";

  if (!/mso-table-lspace/i.test(style)) {
    stats.msoTableSpacing++;
    style += ";mso-table-lspace:0pt;mso-table-rspace:0pt";
    style = style.replace(/^;/, "");
  }

  // Ensure border-collapse:collapse on all tables (except button tables with border-radius)
  if (!/border-collapse/i.test(style)) {
    style += ";border-collapse:collapse;border-spacing:0";
    style = style.replace(/^;/, "");
  }

  $(this).attr("style", style);
});

// ===== 2k. Mirror background-color CSS to bgcolor HTML attribute ===========
$("td, table").each(function () {
  const style = $(this).attr("style") || "";
  const bgMatch = style.match(/background-color\s*:\s*(#[0-9a-fA-F]{3,8})/i);
  if (bgMatch && !$(this).attr("bgcolor")) {
    $(this).attr("bgcolor", bgMatch[1]);
    stats.bgcolorMirrored++;
  }
});

// ===== 2l. Add mso-line-height-rule:exactly to text cells ==================
$("td").each(function () {
  let style = $(this).attr("style") || "";
  // Only add to cells that have text styling (font-size or line-height)
  if ((style.includes("font-size") || style.includes("line-height")) &&
      !style.includes("mso-line-height-rule")) {
    stats.msoLineHeightRuleAdded++;
    style += ";mso-line-height-rule:exactly";
    style = style.replace(/^;/, "");
    $(this).attr("style", style);
  }
});

// ===== 2m. Convert editorblock div margins to table-based padding ==========
// D365 editor adds margin:10px (etc.) to data-editorblocktype divs.
// Outlook's Word engine ignores div margins, causing layout inconsistency.
// Convert to table cell padding for reliable cross-client rendering.
$("[data-editorblocktype]").each(function () {
  const $div = $(this);
  let style = $div.attr("style") || "";

  const marginMatch = style.match(/\bmargin\s*:\s*([^;]+)/i);
  if (!marginMatch) return;

  const marginVal = marginMatch[1].trim();
  if (/^0(px)?\s*(0(px)?\s*)*$/.test(marginVal)) return;

  // Skip if content is already a single table
  const children = $div.children();
  if (children.length === 1 && children.first().is("table")) return;

  // Wrap content in table with the margin as padding
  const content = $div.html();
  $div.html(
    `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse; border-spacing:0; mso-table-lspace:0pt; mso-table-rspace:0pt;"><tbody><tr><td style="padding:${marginVal};">${content}</td></tr></tbody></table>`
  );

  // Reset div margin
  style = style.replace(/\bmargin\s*:\s*[^;]+;?\s*/i, "");
  style = style.replace(/\bpadding\s*:\s*[^;]+;?\s*/i, "");
  style = "margin:0;padding:0;" + style;
  if (!style.includes("mso-para-margin")) {
    style += ";mso-para-margin:0;mso-margin-top-alt:0;mso-margin-bottom-alt:0";
  }
  style = style.replace(/^;/, "").replace(/;\s*;/g, ";").replace(/;\s*$/, "");
  $div.attr("style", style);
  stats.editorblockMarginsConverted = (stats.editorblockMarginsConverted || 0) + 1;
});

// ===== 2n. Add mso-para-margin resets to all div inline styles ==============
$("div").each(function () {
  let style = $(this).attr("style") || "";
  if (!style.includes("mso-para-margin")) {
    stats.msoParaMarginAdded++;
    // Add margin:0 if not already present
    if (!/\bmargin\s*:/i.test(style)) {
      style = "margin:0;padding:0;" + style;
    }
    style += ";mso-para-margin:0;mso-margin-top-alt:0;mso-margin-bottom-alt:0";
    style = style.replace(/^;/, "").replace(/;\s*;/g, ";");
    $(this).attr("style", style);
  }
});

// ===== 2o. Clean up link styles ============================================
$("a").each(function () {
  let style = $(this).attr("style") || "";
  style = style.replace(
    /\b(marginLeft|marginRight|marginTop|marginBottom)\s*:\s*[^;]*;?\s*/gi, ""
  );
  style = style.replace(/;\s*;/g, ";").replace(/;\s*$/, "").replace(/^\s*;/, "").trim();
  if (style) {
    $(this).attr("style", style);
  } else {
    $(this).removeAttr("style");
  }
});

// ===== 2p. Consolidate spacer rows into padding ============================
// Spacer rows look like: <tr><td style="font-size:0;height:16px" height="16">&nbsp;</td></tr>
// We try to merge them into padding on the adjacent content cell.
$("tr").each(function () {
  const $tr = $(this);
  const $tds = $tr.children("td");
  if ($tds.length !== 1) return;

  const $td = $tds.first();
  const style = $td.attr("style") || "";
  const text = $td.text().trim();

  // Detect spacer row: has height, font-size:0, and only contains &nbsp; or is empty
  const heightMatch = style.match(/height\s*:\s*(\d+)px/i);
  if (!heightMatch) return;
  if (!/font-size\s*:\s*0/i.test(style)) return;
  if (text !== "" && text !== "\u00a0" && text !== "&nbsp;") return;

  const spacerHeight = parseInt(heightMatch[1], 10);

  // Try to merge into the next row's first td as padding-top
  const $nextTr = $tr.next("tr");
  if ($nextTr.length) {
    const $nextTd = $nextTr.children("td").first();
    if ($nextTd.length) {
      let nextStyle = $nextTd.attr("style") || "";

      // Check if it already has padding-top
      const ptMatch = nextStyle.match(/padding-top\s*:\s*(\d+)px/i);
      const paddingMatch = nextStyle.match(/padding\s*:\s*(\d+)px\s+(\d+)px\s+(\d+)px\s+(\d+)px/i);
      const paddingShortMatch = nextStyle.match(/padding\s*:\s*(\d+)px\s+(\d+)px/i);

      if (ptMatch) {
        // Add to existing padding-top
        const newPt = parseInt(ptMatch[1], 10) + spacerHeight;
        nextStyle = nextStyle.replace(/padding-top\s*:\s*\d+px/i, `padding-top:${newPt}px`);
      } else if (paddingMatch) {
        // Add to top value of 4-value padding
        const newTop = parseInt(paddingMatch[1], 10) + spacerHeight;
        nextStyle = nextStyle.replace(
          /padding\s*:\s*\d+px\s+(\d+px)\s+(\d+px)\s+(\d+px)/i,
          `padding:${newTop}px $1 $2 $3`
        );
      } else if (paddingShortMatch) {
        // Convert 2-value to 4-value and add
        const vert = parseInt(paddingShortMatch[1], 10);
        const horiz = parseInt(paddingShortMatch[2], 10);
        const newTop = vert + spacerHeight;
        nextStyle = nextStyle.replace(
          /padding\s*:\s*\d+px\s+\d+px/i,
          `padding:${newTop}px ${horiz}px ${vert}px ${horiz}px`
        );
      } else {
        // No existing padding — add padding-top
        nextStyle = `padding-top:${spacerHeight}px;` + nextStyle;
      }

      $nextTd.attr("style", nextStyle);
      $tr.remove();
      stats.spacerRowsConsolidated++;
      return;
    }
  }

  // If can't merge forward, try to merge into previous row's last td as padding-bottom
  const $prevTr = $tr.prev("tr");
  if ($prevTr.length) {
    const $prevTd = $prevTr.children("td").last();
    if ($prevTd.length) {
      let prevStyle = $prevTd.attr("style") || "";

      const pbMatch = prevStyle.match(/padding-bottom\s*:\s*(\d+)px/i);
      if (pbMatch) {
        const newPb = parseInt(pbMatch[1], 10) + spacerHeight;
        prevStyle = prevStyle.replace(/padding-bottom\s*:\s*\d+px/i, `padding-bottom:${newPb}px`);
      } else {
        prevStyle += `;padding-bottom:${spacerHeight}px`;
      }

      prevStyle = prevStyle.replace(/^;/, "").replace(/;\s*;/g, ";");
      $prevTd.attr("style", prevStyle);
      $tr.remove();
      stats.spacerRowsConsolidated++;
    }
  }
});

// ===== 2q. Unwrap unnecessary <span> wrappers ==============================
// Canva wraps text in many <span style="white-space:pre-wrap"> — after removing
// pre-wrap, these become empty-style spans that just add bloat.
$("span").each(function () {
  const $span = $(this);
  const style = $span.attr("style") || "";
  const attrs = $span.get(0)?.attribs || {};

  // If span has no remaining attributes (or only empty style), unwrap it
  const hasStyle = style.trim().length > 0;
  const attrKeys = Object.keys(attrs).filter(k => k !== "style");

  if (!hasStyle && attrKeys.length === 0) {
    $span.replaceWith($span.html());
  }
});

// Remove trailing <br> inside td (Canva adds these after text blocks)
$("td").each(function () {
  const $td = $(this);
  const html = $td.html();
  if (html && html.endsWith("<br>")) {
    $td.html(html.slice(0, -4));
  }
});

// ---------------------------------------------------------------------------
// Phase 3 - Inject head content (D365 meta, MSO styles, responsive CSS)
// ---------------------------------------------------------------------------
const $head = $("head");

// 3a. Ensure D365 designer meta tag
if (!$('meta[type="xrm/designer/setting"]').length) {
  $head.append('\n  <meta type="xrm/designer/setting" name="type" value="marketing-designer-content-editor-document">');
  stats.d365MetaAdded++;
}

// 3b. Ensure proper charset and viewport meta
if (!$('meta[charset]').length && !$('meta[http-equiv="Content-Type"]').length) {
  $head.prepend('\n  <meta charset="utf-8">');
}

// 3c. Inject MSO conditional styles — always replace any existing Canva MSO block
// First, remove any existing <!--[if mso]> blocks from head (Canva includes its own)
// These are rendered as text/comment nodes by cheerio, so we strip them from head HTML
let headHtml = $head.html() || "";
const originalHeadHtml = headHtml;
// Remove <!--[if mso]>...<![endif]--> blocks (Canva's OfficeDocumentSettings etc.)
headHtml = headHtml.replace(/<!--\[if\s+mso\]>[\s\S]*?<!\[endif\]-->/gi, "");
if (headHtml !== originalHeadHtml) {
  $head.html(headHtml);
}

const existingStyles = $head.html() || "";
if (!existingStyles.includes("line-height: 100% !important") &&
    !existingStyles.includes("line-height:100% !important")) {
  const msoStyles = `
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:AllowPNG/>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <style type="text/css">
    body, table, td, th, p, div, span, a { line-height: 100% !important; }
    table { border-collapse: collapse !important; border-spacing: 0 !important; mso-table-lspace: 0pt !important; mso-table-rspace: 0pt !important; }
    td { border-collapse: collapse !important; }
    div, p { margin: 0 !important; padding: 0 !important; mso-para-margin: 0 !important; mso-margin-top-alt: 0 !important; mso-margin-bottom-alt: 0 !important; mso-line-height-rule: exactly !important; }
  </style>
  <![endif]-->`;

  // Insert after the last <meta> tag
  const $lastMeta = $head.find("meta").last();
  if ($lastMeta.length) {
    $lastMeta.after(msoStyles);
  } else {
    $head.prepend(msoStyles);
  }
  stats.msoHeadStylesAdded++;
}

// 3d. Inject global CSS resets if not present
if (!existingStyles.includes("mso-table-lspace") || !existingStyles.includes("-webkit-text-size-adjust")) {
  // Check for existing non-MSO <style> block to append to, or create new one
  let $globalStyle = null;
  $head.find("style").each(function () {
    const content = $(this).html() || "";
    // Find a style block that's NOT inside a conditional comment
    if (content.includes("-webkit-text-size-adjust") || content.includes("mso-table-lspace")) {
      $globalStyle = $(this);
    }
  });

  const globalCSS = `
  <style>
    /* Reset */
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; border-collapse: collapse; border-spacing: 0; }
    td { word-wrap: break-word; word-break: break-word; overflow-wrap: break-word; }
    img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; display: block; }
    body { margin: 0; padding: 0; width: 100%; }
    div { margin: 0; padding: 0; mso-para-margin: 0; mso-margin-top-alt: 0; mso-margin-bottom-alt: 0; }

    /* Responsive */
    @media only screen and (max-width: 600px) {
      .email-wrapper { width: 100% !important; }
      .stack-col { display: block !important; width: 100% !important; max-width: 100% !important; }
      .stack-col-logo { display: block !important; width: 100% !important; max-width: 100% !important; text-align: center !important; }
    }
  </style>`;

  if (!$globalStyle) {
    $head.append(globalCSS);
    stats.responsiveStylesAdded++;
  }
}

// ---------------------------------------------------------------------------
// Phase 4 - Serialize & final string-level cleanup
// ---------------------------------------------------------------------------
let output = $.html();

// 4a. Replace DOCTYPE with HTML5
output = output.replace(
  /<!DOCTYPE[^>]*>/i,
  '<!DOCTYPE html>'
);

// 4b. Ensure html tag has proper namespaces for Outlook VML
output = output.replace(
  /<html[^>]*>/i,
  '<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">'
);

// 4c. Remove any remaining ses:no-track attributes (safety net)
output = output.replace(/\s+ses:no-track="[^"]*"/gi, "");
output = output.replace(/\s+ses:no-track(?=[>\s])/gi, "");

// 4d. Remove conditional comments from body content
// <!--[if mso]>...<![endif]--> in body
output = output.replace(
  /(<body[\s\S]*?)<!--\[if\s+mso\]>[\s\S]*?<!\[endif\]-->/gi,
  (match) => {
    // Only remove if between <body> and </body>
    stats.conditionalCommentsRemovedFromBody++;
    return match.replace(/<!--\[if\s+mso\]>[\s\S]*?<!\[endif\]-->/gi, "");
  }
);
// <!--[if !mso]><!--> ... <!--<![endif]--> in body
output = output.replace(/<!--\[if !mso\]><!-->([\s\S]*?)<!--<!\[endif\]-->/gi, "$1");

// 4e. Remove empty MSO conditional comment shells
output = output.replace(/<!--\[if !mso\]><!-->\s*<!--<!\[endif\]-->\s*/g, "");

// 4f. Clean up double semicolons
output = output.replace(/;\s*;/g, ";");

// 4g. Pretty-print: add newlines after closing tags for readability
output = output
  .replace(/(<\/table>)/gi, "$1\n")
  .replace(/(<\/tr>)/gi, "$1\n")
  .replace(/(<!--\[endif\]-->)/gi, "$1\n");

// 4h. Remove excessive blank lines
output = output.replace(/\n{3,}/g, "\n\n");

// ---------------------------------------------------------------------------
// Write output
// ---------------------------------------------------------------------------
fs.writeFileSync(outputFile, output, "utf-8");

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const inputSize = Buffer.byteLength(raw, "utf-8");
const outputSize = Buffer.byteLength(output, "utf-8");
const saved = inputSize - outputSize;
const pct = ((saved / inputSize) * 100).toFixed(1);

console.log("\n=== CanvaFixer Results ===");
console.log(`Input:  ${inputFile} (${(inputSize / 1024).toFixed(1)} KB)`);
console.log(`Output: ${outputFile} (${(outputSize / 1024).toFixed(1)} KB)`);
if (saved > 0) {
  console.log(`Saved:  ${(saved / 1024).toFixed(1)} KB (${pct}%)\n`);
} else {
  console.log(`Size change: +${(Math.abs(saved) / 1024).toFixed(1)} KB (MSO/D365 attributes added)\n`);
}

console.log("--- Canva Cleanup ---");
const canvaLabels = {
  duplicateMobileBlocksRemoved: "duplicate mobile blocks removed (single-source responsive)",
  conditionalCommentsRemovedFromBody: "conditional comments removed from body (D365 compat)",
  zeroSizeImages: "zero-size images removed (mobile placeholders)",
  preloadLinksRemoved: "link preload tags removed (useless in email)",
  sesNoTrackRemoved: "ses:no-track removed (invalid XHTML)",
  canvaKeywordsMetaRemoved: "Canva keywords meta removed",
};

console.log("\n--- Style Fixes ---");
const styleLabels = {
  invalidStyleProps: "invalid JS-style properties removed",
  negativeBorders: "negative border values removed",
  redundantBorderRadius: "redundant border-radius:0 removed",
  alignNull: 'align="null" removed',
  preWrapFixed: "white-space:pre-wrap removed",
  undefinedMargins: "undefined margin values removed",
  minHeightRemoved: "min-height removed from tables",
  multilinePaddingFixed: "multi-line padding values collapsed",
  marginInlineFixed: "margin-inline-start removed (no Outlook support)",
  doubleSemicolonsFixed: "double semicolons cleaned",
  dataSrcRemoved: "data-src attributes removed",
  fractionalPixelsRounded: "pixel values rounded to multiples of 4 (Outlook fix)",
  relativeLineHeightsFixed: "relative line-heights converted to fixed px",
};

console.log("\n--- Outlook (Word Engine) Fixes ---");
const outlookLabels = {
  msoLineHeightRuleAdded: "mso-line-height-rule:exactly added to text cells",
  imgDisplayBlock: "display:block added to images",
  imgBorderFixed: "border:0 added to linked images",
  msoTableSpacing: "MSO table spacing added",
  bgcolorMirrored: "bgcolor attribute mirrored from CSS background-color",
  msoParaMarginAdded: "mso-para-margin reset added to divs",
  editorblockMarginsConverted: "editorblock div margins → table padding (Outlook fix)",
  spacerRowsConsolidated: "spacer rows consolidated into padding",
};

console.log("\n--- D365 Compatibility ---");
const d365Labels = {
  d365MetaAdded: "D365 designer meta tag added",
  d365ContainerWrapped: "content areas wrapped with data-container",
  msoHeadStylesAdded: "MSO conditional styles injected in head",
  responsiveStylesAdded: "responsive CSS styles injected",
};

const allLabels = { ...canvaLabels, ...styleLabels, ...outlookLabels, ...d365Labels };

// Print grouped
const groups = [
  { title: "Canva Cleanup", keys: Object.keys(canvaLabels) },
  { title: "Style Fixes", keys: Object.keys(styleLabels) },
  { title: "Outlook (Word Engine) Fixes", keys: Object.keys(outlookLabels) },
  { title: "D365 Compatibility", keys: Object.keys(d365Labels) },
];

groups.forEach(({ title, keys }) => {
  console.log(`\n  ${title}:`);
  let groupHits = 0;
  keys.forEach((key) => {
    if (stats[key] > 0) {
      console.log(`    [${String(stats[key]).padStart(3)}] ${allLabels[key]}`);
      groupHits++;
    }
  });
  if (groupHits === 0) {
    console.log("    (none needed)");
  }
});

console.log("\nDone.");
console.log("\nNOTE: For best results, manually verify:");
console.log("  - Content sections are wrapped in data-container + data-editorblocktype divs");
console.log("  - Buttons use data-editorblocktype=\"Text\" (NEVER \"Button\")");
console.log("  - Outer table has minimal rows (consolidate sections where possible)");
console.log("  - Test in D365 designer, then send test to Outlook Desktop");
