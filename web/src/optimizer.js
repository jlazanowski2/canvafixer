/**
 * CanvaFixer - Browser-compatible optimizer module.
 * Ported from optimize.js (Node CLI) to work without fs/path.
 *
 * Usage: import { optimize } from "./optimizer.js";
 *        const { html, stats } = optimize(rawHtmlString);
 */
import * as cheerio from "cheerio";

export function optimize(raw) {
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
    sesNoTrackRemoved: 0,
    d365MarkersAdded: 0,
  };

  // Phase 1 - Preserve original DOCTYPE
  const doctypeMatch = raw.match(/<!DOCTYPE[^>]*>/i);
  const originalDoctype = doctypeMatch
    ? doctypeMatch[0]
    : '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">';

  // Phase 2 - Raw string fixes
  let html = raw;

  html = html.replace(
    /\b(marginLeft|marginRight|marginTop|marginBottom)\s*:\s*undefined\s*;?\s*/gi,
    () => { stats.undefinedMargins++; return ""; }
  );

  html = html.replace(
    /border-(top|bottom|left|right)\s*:\s*-[\d.]+px\s+solid\s+#[0-9a-fA-F]+\s*;?\s*/gi,
    () => { stats.negativeBorders++; return ""; }
  );

  html = html.replace(
    /padding\s*:\s*([\d.]+px)\s*\n\s*([\d.]+px)\s*\n\s*([\d.]+px)\s*\n\s*([\d.]+px)/gi,
    (_, t, r, b, l) => { stats.multilinePaddingFixed++; return `padding:${t} ${r} ${b} ${l}`; }
  );

  // Phase 3 - DOM-level fixes via cheerio
  const $ = cheerio.load(html, { xml: false, decodeEntities: false });

  // 3a. Remove <link rel="preload">
  $('link[rel="preload"]').each(function () {
    $(this).remove();
    stats.preloadLinksRemoved++;
  });

  // 3b. Merge duplicate desktop/mobile blocks
  {
    const desktopBlocks = [];
    $("table[class]").each(function () {
      const cls = $(this).attr("class") || "";
      if (/^layout-\d+$/.test(cls)) {
        desktopBlocks.push({ cls, el: $(this) });
      }
    });

    const responsiveRules = [];

    desktopBlocks.forEach(({ cls, el }) => {
      const mobileSelector = `table[class^="${cls}-under-"]`;
      const $mobile = $(mobileSelector);
      if (!$mobile.length) return;

      const mobileClass = $mobile.attr("class") || "";
      const bpMatch = mobileClass.match(/under-(\d+)/);
      const breakpoint = bpMatch ? parseInt(bpMatch[1], 10) : 450;

      let style = el.attr("style") || "";
      style = style.replace(/display\s*:\s*table\s*;?\s*/gi, "");
      style = style.trim().replace(/;$/, "");
      if (style) el.attr("style", style);
      else el.removeAttr("style");

      const responsiveClass = `responsive-${cls}`;
      el.attr("class", responsiveClass);

      let hasMultiCol = false;
      el.find("tr").each(function () {
        if ($(this).children("td").length > 1) hasMultiCol = true;
      });

      const mobileBp = breakpoint < 100 ? 480 : breakpoint;

      if (hasMultiCol) {
        responsiveRules.push({
          breakpoint: mobileBp,
          css:
            `.${responsiveClass} td { display: block !important; width: 100% !important; box-sizing: border-box !important; text-align: center !important; }` +
            `\n        .${responsiveClass} td[width="4"] { display: none !important; }` +
            `\n        .${responsiveClass} table { margin: 0 auto !important; }`,
        });
      }

      $mobile.remove();
      stats.mobileDupesRemoved++;
    });

    if (responsiveRules.length > 0 || desktopBlocks.length > 0) {
      $("style").each(function () {
        const content = $(this).html() || "";
        if (/layout-\d+/i.test(content)) $(this).remove();
      });

      const prelimBps = [...new Set(responsiveRules.map((r) => r.breakpoint))];
      const globalBp = Math.max(...prelimBps, 480);
      responsiveRules.push({
        breakpoint: globalBp,
        css:
          `table { max-width: 100% !important; }` +
          `\n        img { max-width: 100% !important; height: auto !important; }` +
          `\n        td { box-sizing: border-box !important; }`,
      });

      const allBreakpoints = [...new Set(responsiveRules.map((r) => r.breakpoint))];
      let cssBlock = "";
      allBreakpoints.forEach((bp) => {
        const rules = responsiveRules.filter((r) => r.breakpoint === bp);
        cssBlock +=
          `\n      @media screen and (max-width: ${bp}px) {\n        ` +
          rules.map((r) => r.css).join("\n        ") +
          `\n      }`;
      });

      let baseCss = "";
      desktopBlocks.forEach(({ cls }) => {
        baseCss += `\n      .responsive-${cls} { width: 100% !important; }`;
      });

      if (baseCss || cssBlock) {
        const $styleTag = $("<style>" + baseCss + cssBlock + "\n    </style>");
        $("head").append($styleTag);
        stats.responsiveCssMerged++;
      }
    }
  }

  // 3c. Remove align="null"
  $('[align="null"]').each(function () {
    $(this).removeAttr("align");
    stats.alignNull++;
  });

  // 3c. Fix style attributes
  $("[style]").each(function () {
    let style = $(this).attr("style");
    if (!style) return;

    style = style.replace(
      /\b(marginLeft|marginRight|marginTop|marginBottom)\s*:\s*[^;]*;?\s*/gi,
      () => { stats.invalidStyleProps++; return ""; }
    );
    style = style.replace(
      /border-(top-left|top-right|bottom-left|bottom-right)-radius\s*:\s*0(px)?\s*;?\s*/gi,
      () => { stats.redundantBorderRadius++; return ""; }
    );
    style = style.replace(/border-radius\s*:\s*0(px)?\s*;?\s*/gi, () => {
      stats.redundantBorderRadius++;
      return "";
    });
    style = style.replace(/white-space\s*:\s*pre-wrap\s*;?\s*/gi, () => {
      stats.preWrapFixed++;
      return "";
    });
    if ($(this).is("table") && /min-height/i.test(style)) {
      style = style.replace(/min-height\s*:\s*[^;]+;?\s*/gi, () => {
        stats.minHeightRemoved++;
        return "";
      });
    }
    style = style.replace(
      /margin-inline-start\s*:\s*([^;]+);?\s*/gi,
      () => { stats.marginInlineFixed++; return ""; }
    );
    style = style.replace(/;\s*;/g, () => { stats.doubleSemicolonsFixed++; return ";"; });
    style = style.replace(/;\s*$/, "").replace(/^\s*;/, "").trim();

    if (style) $(this).attr("style", style);
    else $(this).removeAttr("style");
  });

  // 3d. Fix images
  $("img").each(function () {
    const $img = $(this);
    const w = $img.attr("width");
    const h = $img.attr("height");

    if (w === "0" || h === "0") {
      stats.zeroSizeImages++;
      const $parent = $img.parent("a");
      if ($parent.length && $parent.children().length === 1) $parent.remove();
      else $img.remove();
      return;
    }

    if (!$img.attr("alt") && $img.attr("alt") !== "") {
      stats.missingAlt++;
      $img.attr("alt", "");
    }

    let style = $img.attr("style") || "";
    if (!/display\s*:\s*block/i.test(style)) {
      stats.imgDisplayBlock++;
      style = "display:block;" + style;
    }
    if (!/max-width/i.test(style)) style += ";max-width:100%";
    if (!/height\s*:\s*auto/i.test(style)) {
      style = style.replace(/height\s*:\s*\d+[^;]*;?\s*/gi, "");
      style += ";height:auto";
    }

    if ($img.closest("a").length) {
      $img.attr("border", "0");
      if (!/border\s*:/i.test(style)) {
        stats.imgBorderFixed++;
        style += ";border:0";
      }
      const $a = $img.closest("a");
      let aStyle = $a.attr("style") || "";
      if (!/font-size/i.test(aStyle)) aStyle += ";font-size:0";
      if (!/line-height/i.test(aStyle)) aStyle += ";line-height:0";
      if (!/text-decoration/i.test(aStyle)) aStyle += ";text-decoration:none";
      aStyle = aStyle.replace(/^;/, "").replace(/;\s*;/g, ";");
      $a.attr("style", aStyle);

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

    style = style.replace(/;\s*;/g, ";").replace(/;\s*$/, "").replace(/^\s*;/, "").trim();
    $img.attr("style", style);

    if ($img.attr("data-src")) {
      stats.dataSrcRemoved++;
      $img.removeAttr("data-src");
    }
  });

  // 3e. Structural optimization
  $("tr").each(function () {
    const cells = $(this).find("> td");
    if (cells.length === 1) {
      const cell = cells.first();
      const inner = cell.html();
      const style = cell.attr("style") || "";
      if (inner !== null && inner.trim() === "" && !style) {
        $(this).remove();
        stats.emptyRowsRemoved++;
      }
    }
  });

  $("td").each(function () {
    const $td = $(this);
    const inner = $td.html();
    if (!inner) return;
    const trimmed = inner.trim();
    const style = $td.attr("style") || "";

    if (/^(<br\s*\/?\s*>[\s]*)+$/i.test(trimmed) && !/height/i.test(style)) {
      let $row = $td.closest("tr");
      const $parentTable = $row.closest("table");
      const $rows = $parentTable.find("> tbody > tr, > tr");
      if ($rows.length > 1) {
        $row.remove();
        stats.emptyContentRemoved++;

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

  $("td").each(function () {
    const $td = $(this);
    const inner = $td.html();
    if (!inner) return;
    const cleaned = inner.replace(/(\s*<br\s*\/?\s*>\s*)+$/i, "");
    if (cleaned !== inner) $td.html(cleaned);
  });

  // Collapse passthrough tables
  for (let pass = 0; pass < 5; pass++) {
    let collapsed = 0;
    $("table").each(function () {
      const $table = $(this);
      if ($table.attr("class")) return;

      const tbody = $table.find("> tbody");
      const rowParent = tbody.length ? tbody : $table;
      const rows = rowParent.children("tr");
      if (rows.length !== 1) return;

      const cells = rows.first().children("td");
      if (cells.length !== 1) return;

      const cell = cells.first();
      const childTables = cell.children("table");
      if (childTables.length !== 1) return;
      const otherContent = cell.contents().filter(function () {
        if ($(this).is("table")) return false;
        if (this.type === "text" && !$(this).text().trim()) return false;
        return true;
      });
      if (otherContent.length > 0) return;

      const cellStyle = cell.attr("style") || "";
      if (/padding|background|border(?!-collapse|-spacing)/i.test(cellStyle)) return;

      const tableStyle = $table.attr("style") || "";
      if (/background/i.test(tableStyle)) return;

      const $inner = childTables.first();
      const outerWidth = $table.attr("width");
      if (outerWidth && !$inner.attr("width")) $inner.attr("width", outerWidth);

      $table.replaceWith($inner);
      collapsed++;
      stats.passthroughTablesCollapsed++;
    });
    stats.tablesRemoved += collapsed;
    if (collapsed === 0) break;
  }

  // Simplify image centering
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
    const innerStyle = $inner.attr("style") || "";
    if (!/max-width/i.test(innerStyle)) return;
    const innerTd = $inner.find("> tbody > tr > td, > tr > td").first();
    if (!innerTd.length) return;
    if (innerTd.children("img").length !== 1) return;
    if (innerTd.children().length !== 1) return;

    $inner.attr("align", "center");
    if (!/margin/i.test(innerStyle)) $inner.attr("style", innerStyle + ";margin:0 auto");
    $outer.replaceWith($inner);
    stats.imgCenteringSimplified++;
  });

  // 3f. MSO table spacing
  $("table").each(function () {
    let style = $(this).attr("style") || "";
    if (!/mso-table-lspace/i.test(style)) {
      stats.msoTableSpacing++;
      style += ";mso-table-lspace:0pt;mso-table-rspace:0pt";
      style = style.replace(/^;/, "");
      $(this).attr("style", style);
    }
  });

  // 3f. Clean up link styles
  $("a").each(function () {
    // Remove ses:no-track (Amazon SES attribute — invalid XHTML namespace, not needed for D365)
    if ($(this).attr("ses:no-track") !== undefined) {
      $(this).removeAttr("ses:no-track");
      stats.sesNoTrackRemoved++;
    }

    let style = $(this).attr("style") || "";
    style = style.replace(
      /\b(marginLeft|marginRight|marginTop|marginBottom)\s*:\s*[^;]*;?\s*/gi, ""
    );
    style = style.replace(/;\s*;/g, ";").replace(/;\s*$/, "").replace(/^\s*;/, "").trim();
    if (style) $(this).attr("style", style);
    else $(this).removeAttr("style");
  });

  // 3g. D365 content block markers
  {
    const d365Metas = [
      '<meta type="xrm/designer/setting" name="type" value="marketing-designer-content-editor-document">',
      '<meta type="xrm/designer/setting" name="layout-editable" value="marketing-designer-layout-editable">',
      '<meta type="xrm/designer/setting" name="layout-max-width" value="600px" datatype="text" label="Layout max width">',
    ];
    d365Metas.forEach((meta) => $("head").append(meta));

    const $body = $("body");
    const bodyContents = $body.html();
    $body.html(
      '<div data-layout="true" data-layout-version="v2" style="max-width:600px;margin:auto;">' +
        bodyContents +
        "</div>"
    );

    let containerId = 0;
    function nextContainerId() {
      containerId++;
      return "container" + Date.now().toString(36) + containerId.toString(36);
    }

    function detectBlockType($el) {
      if ($el.find("img").length && !$el.find("a.buttonClass").length) return "Image";
      if ($el.find("a").length && $el.find("img").length === 0) return "Button";
      return "Text";
    }

    const $layout = $('div[data-layout="true"]');
    const topTables = $layout.children("table");

    topTables.each(function () {
      const $table = $(this);
      const $rows = $table.find("> tbody > tr, > tr");

      $rows.each(function () {
        $(this).children("td").each(function () {
          const $td = $(this);
          const text = $td.text().trim();
          const hasImg = $td.find("img").length > 0;
          const hasLink = $td.find("a").length > 0;
          const isSpacerOnly =
            !text && !hasImg && !hasLink && /^\s*(&nbsp;)?\s*$/i.test($td.html() || "");

          if (isSpacerOnly) return;

          const blockType = detectBlockType($td);

          if (!$td.find("[data-editorblocktype]").length) {
            const inner = $td.html();
            $td.html(
              '<div data-editorblocktype="' + blockType + '" style="margin:0;">' + inner + "</div>"
            );
          }

          if (!$td.attr("data-container")) {
            $td.attr("data-container", "true");
            $td.attr("id", nextContainerId());
          }
        });
      });

      if (!$table.parent('[data-section="true"]').length) {
        const bgMatch = ($table.attr("style") || "").match(/background-color\s*:\s*([^;]+)/i);
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

  // Phase 4 - Serialize & cleanup
  let output = $.html();

  output = output.replace(/<!DOCTYPE[^>]*>/i, originalDoctype);

  // XHTML compliance: self-close void elements (required by XHTML DOCTYPE for D365)
  output = output.replace(/<(meta|img|br|hr|link|input)(\s[^>]*?)?\s*>/gi, (match, tag, attrs) => {
    attrs = attrs || "";
    if (/\/\s*$/.test(attrs)) return match;
    return `<${tag}${attrs} />`;
  });

  // XHTML compliance: ensure <html> has xmlns attribute
  output = output.replace(/<html(?![^>]*xmlns)([^>]*)>/i, '<html xmlns="http://www.w3.org/1999/xhtml"$1>');

  // Remove any remaining ses:no-track attributes (safety net — cheerio may not handle namespaced attrs)
  output = output.replace(/\s+ses:no-track="[^"]*"/gi, "");

  output = output
    .replace(/(<\/table>)/gi, "$1\n")
    .replace(/(<\/tr>)/gi, "$1\n")
    .replace(/(<\/td>)/gi, "$1\n")
    .replace(/(<!--\[endif\]-->)/gi, "$1\n")
    .replace(/(<!--<!\[endif\]-->)/gi, "$1\n");

  output = output.replace(/<!--\[if !mso\]><!-->\s*<!--<!\[endif\]-->\s*/g, "");
  output = output.replace(/;\s*;/g, ";");
  output = output.replace(/\n{3,}/g, "\n\n");

  const inputSize = new Blob([raw]).size;
  const outputSize = new Blob([output]).size;

  return { html: output, stats, inputSize, outputSize };
}

export const statLabels = {
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
  sesNoTrackRemoved: "ses:no-track removed (invalid XHTML namespace)",
  d365MarkersAdded: "D365 content block sections created",
};
