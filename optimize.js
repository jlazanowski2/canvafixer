#!/usr/bin/env node
/**
 * CanvaFixer - Optimizes Canva HTML email exports for email clients.
 * Targets: Outlook (Word engine), Gmail, iOS Mail, webmail clients.
 *
 * Usage: node optimize.js input.html [output.html]
 *   If output is omitted, writes to input.optimized.html
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
  invalidStyleProps: 0,
  negativeBorders: 0,
  redundantBorderRadius: 0,
  alignNull: 0,
  preWrapFixed: 0,
  undefinedMargins: 0,
  zeroSizeImages: 0,
  missingAlt: 0,
  minHeightRemoved: 0,
  preloadLinksRemoved: 0,
  multilinePaddingFixed: 0,
  marginInlineFixed: 0,
  doubleSemicolonsFixed: 0,
  imgDisplayBlock: 0,
  imgBorderFixed: 0,
  msoTableSpacing: 0,
  dataSrcRemoved: 0,
  passthroughTablesCollapsed: 0,
  emptyRowsRemoved: 0,
  emptyContentRemoved: 0,
  imgCenteringSimplified: 0,
  tablesRemoved: 0,
  mobileDupesRemoved: 0,
  responsiveCssMerged: 0,
};

// ---------------------------------------------------------------------------
// Phase 1 - Preserve the original DOCTYPE
//   Cheerio may mangle the DOCTYPE, so we capture it and restore later.
// ---------------------------------------------------------------------------
const doctypeMatch = raw.match(/<!DOCTYPE[^>]*>/i);
const originalDoctype = doctypeMatch
  ? doctypeMatch[0]
  : '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">';

// ---------------------------------------------------------------------------
// Phase 2 - Raw string fixes (before DOM parse)
// ---------------------------------------------------------------------------
let html = raw;

// Fix camelCase inline-style properties leaked from React/JS
// e.g.  marginLeft: undefined;  marginRight: undefined;
html = html.replace(
  /\b(marginLeft|marginRight|marginTop|marginBottom)\s*:\s*undefined\s*;?\s*/gi,
  () => {
    stats.undefinedMargins++;
    return "";
  }
);

// Fix negative border values (invalid CSS)
html = html.replace(
  /border-(top|bottom|left|right)\s*:\s*-[\d.]+px\s+solid\s+#[0-9a-fA-F]+\s*;?\s*/gi,
  () => {
    stats.negativeBorders++;
    return "";
  }
);

// Fix multi-line padding values (Canva sometimes splits padding across lines)
html = html.replace(
  /padding\s*:\s*([\d.]+px)\s*\n\s*([\d.]+px)\s*\n\s*([\d.]+px)\s*\n\s*([\d.]+px)/gi,
  (_, t, r, b, l) => {
    stats.multilinePaddingFixed++;
    return `padding:${t} ${r} ${b} ${l}`;
  }
);

// ---------------------------------------------------------------------------
// Phase 3 - DOM-level fixes via cheerio
// ---------------------------------------------------------------------------
const $ = cheerio.load(html, { xml: false, decodeEntities: false });

// 3a. Remove <link rel="preload"> (not useful in email clients) -------------
$('link[rel="preload"]').each(function () {
  $(this).remove();
  stats.preloadLinksRemoved++;
});

// 3b. Merge duplicate desktop/mobile blocks into single responsive blocks ---
// Canva creates pairs: .layout-X (desktop, display:table) and
// .layout-X-under-Y (mobile, display:none) with identical content.
// We keep the desktop block, make it fluid/responsive with CSS, and delete
// the mobile duplicate entirely.
{
  // Collect all layout class pairs
  const desktopBlocks = [];
  $("table[class]").each(function () {
    const cls = $(this).attr("class") || "";
    // Match desktop blocks like "layout-0", "layout-1", "layout-2"
    // but NOT the mobile ones like "layout-0-under-1"
    if (/^layout-\d+$/.test(cls)) {
      desktopBlocks.push({ cls, el: $(this) });
    }
  });

  // Track breakpoints needed for responsive CSS
  const responsiveRules = [];

  desktopBlocks.forEach(({ cls, el }) => {
    // Find the matching mobile duplicate
    const mobileSelector = `table[class^="${cls}-under-"]`;
    const $mobile = $(mobileSelector);
    if (!$mobile.length) return;

    // Extract the breakpoint from the mobile class (e.g., "layout-1-under-450" -> 450)
    const mobileClass = $mobile.attr("class") || "";
    const bpMatch = mobileClass.match(/under-(\d+)/);
    const breakpoint = bpMatch ? parseInt(bpMatch[1], 10) : 450;

    // Make the desktop block fluid instead of fixed display:table
    let style = el.attr("style") || "";
    // Remove display:table (let it be a normal block-level table)
    style = style.replace(/display\s*:\s*table\s*;?\s*/gi, "");
    style = style.trim().replace(/;$/, "");
    if (style) el.attr("style", style);
    else el.removeAttr("style");

    // Remove the class from the desktop block (no longer needed for show/hide)
    // Give it a new clean class for responsive targeting
    const responsiveClass = `responsive-${cls}`;
    el.attr("class", responsiveClass);

    // Check if this is a multi-column layout (has multiple td siblings in any row)
    let hasMultiCol = false;
    el.find("tr").each(function () {
      const tds = $(this).children("td");
      if (tds.length > 1) hasMultiCol = true;
    });

    // Build responsive CSS rules for this block
    // Use a sensible breakpoint — Canva sometimes sets 1px (= never triggers)
    const mobileBp = breakpoint < 100 ? 480 : breakpoint;

    if (hasMultiCol) {
      // Multi-column: stack columns on mobile, center content
      responsiveRules.push({
        breakpoint: mobileBp,
        css:
          `.${responsiveClass} td { display: block !important; width: 100% !important; box-sizing: border-box !important; text-align: center !important; }` +
          `\n        .${responsiveClass} td[width="4"] { display: none !important; }` +
          `\n        .${responsiveClass} table { margin: 0 auto !important; }`,
      });
    }

    // Remove the mobile duplicate and its surrounding MSO conditional comments
    // The mobile block is wrapped in <!--[if !mso]><!--> ... <!--<![endif]-->
    $mobile.remove();
    stats.mobileDupesRemoved++;
  });

  // Replace Canva's original show/hide media queries with our fluid responsive CSS
  if (responsiveRules.length > 0 || desktopBlocks.length > 0) {
    // Remove all existing Canva layout style blocks
    $("style").each(function () {
      const content = $(this).html() || "";
      if (/layout-\d+/i.test(content)) {
        $(this).remove();
      }
    });

    // Global mobile rules to prevent overflow and center content
    const prelimBps = [...new Set(responsiveRules.map((r) => r.breakpoint))];
    const globalBp = Math.max(...prelimBps, 480);
    responsiveRules.push({
      breakpoint: globalBp,
      css:
        `table { max-width: 100% !important; }` +
        `\n        img { max-width: 100% !important; height: auto !important; }` +
        `\n        td { box-sizing: border-box !important; }`,
    });

    // Build consolidated responsive stylesheet
    const allBreakpoints = [...new Set(responsiveRules.map((r) => r.breakpoint))];
    let cssBlock = "";
    allBreakpoints.forEach((bp) => {
      const rules = responsiveRules.filter((r) => r.breakpoint === bp);
      cssBlock +=
        `\n      @media screen and (max-width: ${bp}px) {\n        ` +
        rules.map((r) => r.css).join("\n        ") +
        `\n      }`;
    });

    // Add base fluid styles for all responsive blocks
    let baseCss = "";
    desktopBlocks.forEach(({ cls }) => {
      baseCss += `\n      .responsive-${cls} { width: 100% !important; }`;
    });

    if (baseCss || cssBlock) {
      const $styleTag = $("<style>" + baseCss + cssBlock + "\n    </style>");
      // Insert before closing </head> — find last element in head
      $("head").append($styleTag);
      stats.responsiveCssMerged++;
    }
  }
}

// 3c. Remove align="null" ---------------------------------------------------
$('[align="null"]').each(function () {
  $(this).removeAttr("align");
  stats.alignNull++;
});

// 3c. Fix style attributes --------------------------------------------------
$("[style]").each(function () {
  let style = $(this).attr("style");
  if (!style) return;

  // Remove leftover camelCase properties (catch any the regex missed)
  style = style.replace(
    /\b(marginLeft|marginRight|marginTop|marginBottom)\s*:\s*[^;]*;?\s*/gi,
    () => {
      stats.invalidStyleProps++;
      return "";
    }
  );

  // Remove border-radius: 0 / 0px (adds no value, just bloat)
  style = style.replace(
    /border-(top-left|top-right|bottom-left|bottom-right)-radius\s*:\s*0(px)?\s*;?\s*/gi,
    () => {
      stats.redundantBorderRadius++;
      return "";
    }
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

  // Fix margin-inline-start (not supported in Outlook) -> padding-left
  style = style.replace(
    /margin-inline-start\s*:\s*([^;]+);?\s*/gi,
    (_, val) => {
      stats.marginInlineFixed++;
      return "";
    }
  );

  // Clean up double/trailing semicolons from removals
  style = style.replace(/;\s*;/g, () => {
    stats.doubleSemicolonsFixed++;
    return ";";
  });
  style = style.replace(/;\s*$/, "").replace(/^\s*;/, "").trim();

  if (style) {
    $(this).attr("style", style);
  } else {
    $(this).removeAttr("style");
  }
});

// 3d. Fix images -------------------------------------------------------------
$("img").each(function () {
  const $img = $(this);
  const w = $img.attr("width");
  const h = $img.attr("height");

  // Remove zero-dimension images (Canva mobile placeholders)
  if (w === "0" || h === "0") {
    stats.zeroSizeImages++;
    const $parent = $img.parent("a");
    if ($parent.length && $parent.children().length === 1) {
      $parent.remove();
    } else {
      $img.remove();
    }
    return;
  }

  // Add missing alt text (empty alt is better than no alt for accessibility)
  if (!$img.attr("alt") && $img.attr("alt") !== "") {
    stats.missingAlt++;
    $img.attr("alt", "");
  }

  // Ensure display:block on all images (prevents gaps in Outlook/Gmail)
  let style = $img.attr("style") || "";
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

  // Ensure border:0 for linked images (prevents blue border in older clients)
  // Also fix Outlook phantom underline by zeroing font-size/line-height on the <a>
  if ($img.closest("a").length) {
    $img.attr("border", "0");
    if (!/border\s*:/i.test(style)) {
      stats.imgBorderFixed++;
      style += ";border:0";
    }

    const $a = $img.closest("a");
    let aStyle = $a.attr("style") || "";
    // Kill Outlook's phantom underline: zero out font-size and line-height on the link
    if (!/font-size/i.test(aStyle)) {
      aStyle += ";font-size:0";
    }
    if (!/line-height/i.test(aStyle)) {
      aStyle += ";line-height:0";
    }
    if (!/text-decoration/i.test(aStyle)) {
      aStyle += ";text-decoration:none";
    }
    aStyle = aStyle.replace(/^;/, "").replace(/;\s*;/g, ";");
    $a.attr("style", aStyle);

    // Also set the parent td's line-height to 0 to prevent Outlook spacing
    const $td = $a.parent("td");
    if ($td.length) {
      let tdStyle = $td.attr("style") || "";
      if (!/font-size/i.test(tdStyle)) {
        tdStyle += ";font-size:0;line-height:0";
        tdStyle = tdStyle.replace(/^;/, "");
        $td.attr("style", tdStyle);
      }
    }
  }

  // Clean up double semicolons in image styles
  style = style.replace(/;\s*;/g, ";").replace(/;\s*$/, "").replace(/^\s*;/, "").trim();
  $img.attr("style", style);

  // Remove data-src (not used by email clients)
  if ($img.attr("data-src")) {
    stats.dataSrcRemoved++;
    $img.removeAttr("data-src");
  }
});

// 3e. Structural HTML optimization ------------------------------------------
// Remove completely empty rows (no content, no height spacer)
$("tr").each(function () {
  const cells = $(this).find("> td");
  if (cells.length === 1) {
    const cell = cells.first();
    const inner = cell.html();
    const style = cell.attr("style") || "";
    // Only remove if truly empty (no content, no height/font-size spacer)
    if (inner !== null && inner.trim() === "" && !style) {
      $(this).remove();
      stats.emptyRowsRemoved++;
    }
  }
});

// Remove rows whose only content is <br> tags (Canva empty placeholders).
// Also remove the parent wrapper row/table if it becomes empty.
$("td").each(function () {
  const $td = $(this);
  const inner = $td.html();
  if (!inner) return;
  const trimmed = inner.trim();
  const style = $td.attr("style") || "";

  // Match cells that contain ONLY <br> tags (not spacer &nbsp; cells which have height)
  if (/^(<br\s*\/?\s*>[\s]*)+$/i.test(trimmed) && !/height/i.test(style)) {
    // Remove the entire row containing this td
    let $row = $td.closest("tr");
    const $parentTable = $row.closest("table");
    const $rows = $parentTable.find("> tbody > tr, > tr");
    if ($rows.length > 1) {
      $row.remove();
      stats.emptyContentRemoved++;

      // If parent table is now empty or only has empty spacer rows, remove the
      // whole wrapper chain (td > table) up to the next table with real content
      const remaining = $parentTable.find("> tbody > tr, > tr");
      if (remaining.length === 0) {
        const $wrapperTd = $parentTable.parent("td");
        if ($wrapperTd.length) {
          const $wrapperRow = $wrapperTd.parent("tr");
          if ($wrapperRow.length) {
            $wrapperRow.remove();
            stats.emptyContentRemoved++;
          }
        }
      }
    }
  }
});

// Strip trailing <br> from tds that have real content followed by stray breaks
$("td").each(function () {
  const $td = $(this);
  const inner = $td.html();
  if (!inner) return;
  // Remove trailing <br> after real content (e.g., image link followed by <br>)
  const cleaned = inner.replace(/(\s*<br\s*\/?\s*>\s*)+$/i, "");
  if (cleaned !== inner) {
    $td.html(cleaned);
  }
});

// Collapse passthrough wrapper tables:
// A table with 1 row, 1 cell, whose only child is another table,
// and the wrapper td has no meaningful styles (no padding, background, border).
// We merge by replacing the outer table>tbody>tr>td with just the inner table.
// Run multiple passes since collapsing one layer may expose another.
for (let pass = 0; pass < 5; pass++) {
  let collapsed = 0;
  $("table").each(function () {
    const $table = $(this);
    // Skip tables inside MSO conditional comments (they're special)
    // Skip tables with classes (they're used for responsive show/hide)
    if ($table.attr("class")) return;

    const tbody = $table.find("> tbody");
    const rowParent = tbody.length ? tbody : $table;
    const rows = rowParent.children("tr");
    if (rows.length !== 1) return;

    const cells = rows.first().children("td");
    if (cells.length !== 1) return;

    const cell = cells.first();
    const childTables = cell.children("table");
    // Must have exactly 1 child table and no other meaningful content
    if (childTables.length !== 1) return;
    const otherContent = cell
      .contents()
      .filter(function () {
        if ($(this).is("table")) return false;
        if (this.type === "text" && !$(this).text().trim()) return false;
        return true;
      });
    if (otherContent.length > 0) return;

    const cellStyle = cell.attr("style") || "";
    // Keep if the cell provides padding, background, or real borders
    if (/padding|background|border(?!-collapse|-spacing)/i.test(cellStyle)) return;

    const tableStyle = $table.attr("style") || "";
    // Keep if the outer table provides background color
    if (/background/i.test(tableStyle)) return;

    // Safe to collapse: replace this table with its inner table child
    const $inner = childTables.first();

    // Merge any useful style properties from outer table to inner
    // (mainly width, max-width, table-layout, margin)
    const outerWidth = $table.attr("width");
    if (outerWidth && !$inner.attr("width")) {
      $inner.attr("width", outerWidth);
    }

    $table.replaceWith($inner);
    collapsed++;
    stats.passthroughTablesCollapsed++;
  });
  stats.tablesRemoved += collapsed;
  if (collapsed === 0) break;
}

// Simplify image centering pattern:
// table width:100% > tr > td align=center > table max-width:Xpx > tr > td > img
// Collapse the outer centering table, move align=center to inner table's parent
$("table").each(function () {
  const $outer = $(this);
  const tbody = $outer.find("> tbody");
  const rowParent = tbody.length ? tbody : $outer;
  const rows = rowParent.children("tr");
  if (rows.length !== 1) return;

  const cells = rows.first().children("td");
  if (cells.length !== 1) return;

  const cell = cells.first();
  if (cell.attr("align") !== "center") return;

  const innerTables = cell.children("table");
  if (innerTables.length !== 1) return;

  const $inner = innerTables.first();
  // Check inner table has max-width and contains an image
  const innerStyle = $inner.attr("style") || "";
  if (!/max-width/i.test(innerStyle)) return;
  const innerTd = $inner.find("> tbody > tr > td, > tr > td").first();
  if (!innerTd.length) return;
  const img = innerTd.children("img");
  if (img.length !== 1) return;
  // Other content in the inner td? Skip.
  if (innerTd.children().length !== 1) return;

  // Collapse: replace outer table with inner table, add margin:0 auto for centering
  $inner.attr("align", "center");
  if (!/margin/i.test(innerStyle)) {
    $inner.attr("style", innerStyle + ";margin:0 auto");
  }
  $outer.replaceWith($inner);
  stats.imgCenteringSimplified++;
});

// 3f. Add Outlook-safe MSO table spacing ------------------------------------
$("table").each(function () {
  const $table = $(this);
  let style = $table.attr("style") || "";
  if (!/mso-table-lspace/i.test(style)) {
    stats.msoTableSpacing++;
    style += ";mso-table-lspace:0pt;mso-table-rspace:0pt";
    style = style.replace(/^;/, "");
    $table.attr("style", style);
  }
});

// 3f. Clean up link styles ---------------------------------------------------
$("a").each(function () {
  const $a = $(this);
  let style = $a.attr("style") || "";
  // Remove leaked JS margin properties
  style = style.replace(
    /\b(marginLeft|marginRight|marginTop|marginBottom)\s*:\s*[^;]*;?\s*/gi,
    ""
  );
  style = style.replace(/;\s*;/g, ";").replace(/;\s*$/, "").replace(/^\s*;/, "").trim();
  if (style) {
    $a.attr("style", style);
  } else {
    $a.removeAttr("style");
  }
});

// ---------------------------------------------------------------------------
// Phase 3g - Dynamics 365 content block markers
//   Wraps content in D365 editor-compatible structure so sections remain
//   editable after pasting into D365 Marketing email editor.
// ---------------------------------------------------------------------------
{
  // Add D365 designer meta tags to <head>
  const d365Metas = [
    '<meta type="xrm/designer/setting" name="type" value="marketing-designer-content-editor-document">',
    '<meta type="xrm/designer/setting" name="layout-editable" value="marketing-designer-layout-editable">',
    '<meta type="xrm/designer/setting" name="layout-max-width" value="600px" datatype="text" label="Layout max width">',
  ];
  d365Metas.forEach((meta) => {
    $("head").append(meta);
  });

  // Wrap body content in D365 layout div
  const $body = $("body");
  const bodyContents = $body.html();
  $body.html(
    '<div data-layout="true" data-layout-version="v2" style="max-width:600px;margin:auto;">' +
      bodyContents +
      "</div>"
  );

  // Helper: generate unique container IDs
  let containerId = 0;
  function nextContainerId() {
    containerId++;
    return "container" + Date.now().toString(36) + containerId.toString(36);
  }

  // Helper: detect content type for data-editorblocktype
  function detectBlockType($el) {
    if ($el.find("img").length && !$el.find("a.buttonClass").length) return "Image";
    if ($el.find("a").length && $el.find("img").length === 0) return "Button";
    return "Text";
  }

  // Identify top-level content tables (direct children of the layout div's td cells)
  // and wrap each major row in D365 section markup.
  // Strategy: find each top-level table in the layout div and wrap it as a section.
  const $layout = $('div[data-layout="true"]');
  const topTables = $layout.children("table");

  topTables.each(function () {
    const $table = $(this);

    // Find content rows — rows that have visible content (not just spacers)
    const $rows = $table.find("> tbody > tr, > tr");

    $rows.each(function () {
      const $row = $(this);
      const $cells = $row.children("td");

      $cells.each(function () {
        const $td = $(this);
        const text = $td.text().trim();
        const hasImg = $td.find("img").length > 0;
        const hasLink = $td.find("a").length > 0;
        const isSpacerOnly =
          !text && !hasImg && !hasLink && /^\s*(&nbsp;)?\s*$/i.test($td.html() || "");

        // Skip spacer cells
        if (isSpacerOnly) return;

        // Determine block type from content
        const blockType = detectBlockType($td);

        // Wrap inner content in data-editorblocktype div if not already wrapped
        if (!$td.find("[data-editorblocktype]").length) {
          const inner = $td.html();
          $td.html(
            '<div data-editorblocktype="' + blockType + '" style="margin:0;">' +
              inner +
              "</div>"
          );
        }

        // Add data-container to the td if it doesn't have one
        if (!$td.attr("data-container")) {
          $td.attr("data-container", "true");
          $td.attr("id", nextContainerId());
        }
      });
    });

    // Wrap the table in a data-section div
    if (!$table.parent('[data-section="true"]').length) {
      const bgMatch = ($table.attr("style") || "").match(
        /background-color\s*:\s*([^;]+)/i
      );
      const bgColor = bgMatch ? bgMatch[1].trim() : "transparent";
      const $section = $(
        '<div data-section="true" class="columns-equal-class wrap-section" style="margin:0;border-radius:0;background-color:' +
          bgColor +
          ';"></div>'
      );
      $table.before($section);
      $section.append($table);
    }
  });

  stats.d365MarkersAdded = topTables.length;
}

// ---------------------------------------------------------------------------
// Phase 4 - Serialize & final string-level cleanup
// ---------------------------------------------------------------------------
let output = $.html();

// Restore original DOCTYPE (cheerio may have mangled it)
output = output.replace(/<!DOCTYPE[^>]*>/i, originalDoctype);

// Pretty-print: add newlines after closing tags for readability
output = output
  .replace(/(<\/table>)/gi, "$1\n")
  .replace(/(<\/tr>)/gi, "$1\n")
  .replace(/(<\/td>)/gi, "$1\n")
  .replace(/(<!--\[endif\]-->)/gi, "$1\n")
  .replace(/(<!--<!\[endif\]-->)/gi, "$1\n");

// Remove empty MSO conditional comment shells left after removing style blocks
output = output.replace(/<!--\[if !mso\]><!-->\s*<!--<!\[endif\]-->\s*/g, "");

// Final cleanup: double semicolons that slipped through
output = output.replace(/;\s*;/g, ";");

// Remove excessive blank lines
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
  console.log(`Size change: +${(Math.abs(saved) / 1024).toFixed(1)} KB (MSO attributes added)\n`);
}
console.log("Fixes applied:");
const labels = {
  invalidStyleProps: "invalid JS-style properties removed",
  negativeBorders: "negative border values removed",
  redundantBorderRadius: "redundant border-radius:0 removed",
  alignNull: 'align="null" removed',
  preWrapFixed: "white-space:pre-wrap removed",
  undefinedMargins: "undefined margin values removed",
  zeroSizeImages: "zero-size images removed",
  missingAlt: "missing alt attributes added",
  minHeightRemoved: "min-height removed from tables",
  preloadLinksRemoved: "link preload tags removed (useless in email)",
  multilinePaddingFixed: "multi-line padding values collapsed",
  marginInlineFixed: "margin-inline-start removed (no Outlook support)",
  doubleSemicolonsFixed: "double semicolons cleaned",
  imgDisplayBlock: "display:block added to images",
  imgBorderFixed: "border:0 added to linked images",
  msoTableSpacing: "MSO table spacing added (Outlook fix)",
  dataSrcRemoved: "data-src attributes removed",
  passthroughTablesCollapsed: "passthrough wrapper tables collapsed",
  emptyRowsRemoved: "empty rows removed",
  emptyContentRemoved: "empty content wrappers removed (<br> only)",
  imgCenteringSimplified: "image centering tables simplified",
  tablesRemoved: "total tables eliminated",
  mobileDupesRemoved: "mobile duplicate blocks removed",
  responsiveCssMerged: "responsive CSS consolidated",
  d365MarkersAdded: "D365 content block sections created",
};
Object.entries(stats).forEach(([key, count]) => {
  if (count > 0) {
    console.log(`  [${String(count).padStart(3)}] ${labels[key] || key}`);
  }
});
console.log("\nDone.");
