/**
 * CanvaFixer - Browser-compatible optimizer module (Pass 1).
 * Handles all mechanical/deterministic fixes. The structural rewrite
 * (Pass 2) is done server-side by the LLM.
 *
 * Usage: import { optimize, statLabels } from "./optimizer.js";
 *        const { html, stats, inputSize, outputSize } = optimize(rawHtmlString);
 */
import * as cheerio from "cheerio";

export function optimize(raw) {
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
    fractionalPixelsRounded: 0,
    relativeLineHeightsFixed: 0,

    // Outlook fixes
    msoLineHeightRuleAdded: 0,
    imgDisplayBlock: 0,
    imgBorderFixed: 0,
    msoTableSpacing: 0,
    bgcolorMirrored: 0,
    msoParaMarginAdded: 0,
    spacerRowsConsolidated: 0,

    // D365 additions
    d365MetaAdded: 0,
    msoHeadStylesAdded: 0,
    responsiveStylesAdded: 0,
  };

  // Phase 1 - Raw string fixes
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

  // Phase 2 - DOM-level fixes
  const $ = cheerio.load(html, { xml: false, decodeEntities: false });

  // Remove Canva duplicate mobile blocks
  $('[class*="-under-"]').each(function () {
    const cls = $(this).attr("class") || "";
    if (/layout-\d+-under-\d+/i.test(cls)) {
      stats.duplicateMobileBlocksRemoved++;
      $(this).remove();
    }
  });

  // Remove style blocks that only contain layout show/hide rules
  $("style").each(function () {
    const content = $(this).html() || "";
    if (/^\s*@media[^{]*\{[\s\S]*?layout-\d+(-under-\d+)?[\s\S]*?\}\s*$/i.test(content) &&
        !/[^.#\w-](?!layout-)\w+\s*\{/i.test(content)) {
      $(this).remove();
    }
  });

  // Remove preload links
  $('link[rel="preload"]').each(function () {
    $(this).remove();
    stats.preloadLinksRemoved++;
  });

  // Remove Canva keywords meta
  $('meta[name="keywords"]').each(function () {
    const content = $(this).attr("content") || "";
    if (/^[A-Za-z0-9,\s]+$/.test(content) && content.length < 100) {
      $(this).remove();
      stats.canvaKeywordsMetaRemoved++;
    }
  });

  // Remove align="null"
  $('[align="null"]').each(function () {
    $(this).removeAttr("align");
    stats.alignNull++;
  });

  // Remove zero-size images
  $("img").each(function () {
    const w = $(this).attr("width");
    const h = $(this).attr("height");
    if (w === "0" || h === "0") {
      stats.zeroSizeImages++;
      const $parent = $(this).parent("a");
      if ($parent.length && $parent.children().length === 1) $parent.remove();
      else $(this).remove();
    }
  });

  // Remove ses:no-track
  $("a").each(function () {
    if ($(this).attr("ses:no-track") !== undefined) {
      $(this).removeAttr("ses:no-track");
      stats.sesNoTrackRemoved++;
    }
  });

  // Fix style attributes
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

    // Round fractional pixels: borders→nearest int, everything else→mult of 4
    style = style.replace(
      /([\w-]*)\s*:\s*([^;]*?)([\d]*\.[\d]+)px/g,
      (match, prop, prefix, num) => {
        const val = parseFloat(num);
        const isBorder = /border/i.test(prop);
        let rounded = isBorder ? Math.round(val) : Math.round(val / 4) * 4;
        const final = rounded === 0 && val > 0 ? (isBorder ? 1 : 4) : rounded;
        if (final !== val) stats.fractionalPixelsRounded++;
        return `${prop}:${prefix}${final}px`;
      }
    );

    // Round font-size/line-height integers to mult of 4
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

    // Convert relative line-heights to fixed pixel
    style = style.replace(
      /line-height\s*:\s*([\d.]+)\s*(?:;|$)/gi,
      (match, val) => {
        const num = parseFloat(val);
        if (num > 0 && num < 5 && !match.includes("px") && !match.includes("em") && !match.includes("%")) {
          const fsMatch = style.match(/font-size\s*:\s*(\d+)px/i);
          const fontSize = fsMatch ? parseInt(fsMatch[1], 10) : 16;
          let computed = Math.round(fontSize * num);
          computed = Math.round(computed / 4) * 4;
          if (computed === 0) computed = 4;
          stats.relativeLineHeightsFixed++;
          return `line-height:${computed}px${match.endsWith(";") ? ";" : ""}`;
        }
        return match;
      }
    );

    style = style.replace(/;\s*;/g, () => { stats.doubleSemicolonsFixed++; return ";"; });
    style = style.replace(/;\s*$/, "").replace(/^\s*;/, "").trim();

    if (style) $(this).attr("style", style);
    else $(this).removeAttr("style");
  });

  // Fix images
  $("img").each(function () {
    const $img = $(this);
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

    // Round image dimensions to mult of 4
    ["width", "height"].forEach((attr) => {
      const v = $img.attr(attr);
      if (v) {
        const val = parseInt(v, 10);
        if (!isNaN(val) && val > 0) {
          const rounded = Math.round(val / 4) * 4 || 4;
          if (rounded !== val) {
            $img.attr(attr, String(rounded));
            stats.fractionalPixelsRounded++;
          }
        }
      }
    });

    if (!$img.attr("alt") && $img.attr("alt") !== "") $img.attr("alt", "");

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

    style = style.replace(/;\s*;/g, ";").replace(/;\s*$/, "").replace(/^\s*;/, "").trim();
    $img.attr("style", style);

    if ($img.attr("data-src")) {
      stats.dataSrcRemoved++;
      $img.removeAttr("data-src");
    }
  });

  // MSO table spacing
  $("table").each(function () {
    let style = $(this).attr("style") || "";
    if (!/mso-table-lspace/i.test(style)) {
      stats.msoTableSpacing++;
      style += ";mso-table-lspace:0pt;mso-table-rspace:0pt";
      style = style.replace(/^;/, "");
    }
    if (!/border-collapse/i.test(style)) {
      style += ";border-collapse:collapse;border-spacing:0";
      style = style.replace(/^;/, "");
    }
    $(this).attr("style", style);
  });

  // Mirror background-color to bgcolor
  $("td, table").each(function () {
    const style = $(this).attr("style") || "";
    const bgMatch = style.match(/background-color\s*:\s*(#[0-9a-fA-F]{3,8})/i);
    if (bgMatch && !$(this).attr("bgcolor")) {
      $(this).attr("bgcolor", bgMatch[1]);
      stats.bgcolorMirrored++;
    }
  });

  // Add mso-line-height-rule:exactly to text cells
  $("td").each(function () {
    let style = $(this).attr("style") || "";
    if ((style.includes("font-size") || style.includes("line-height")) &&
        !style.includes("mso-line-height-rule")) {
      stats.msoLineHeightRuleAdded++;
      style += ";mso-line-height-rule:exactly";
      style = style.replace(/^;/, "");
      $(this).attr("style", style);
    }
  });

  // Add mso-para-margin resets to divs
  $("div").each(function () {
    let style = $(this).attr("style") || "";
    if (!style.includes("mso-para-margin")) {
      stats.msoParaMarginAdded++;
      if (!/\bmargin\s*:/i.test(style)) {
        style = "margin:0;padding:0;" + style;
      }
      style += ";mso-para-margin:0;mso-margin-top-alt:0;mso-margin-bottom-alt:0";
      style = style.replace(/^;/, "").replace(/;\s*;/g, ";");
      $(this).attr("style", style);
    }
  });

  // Clean link styles
  $("a").each(function () {
    let style = $(this).attr("style") || "";
    style = style.replace(
      /\b(marginLeft|marginRight|marginTop|marginBottom)\s*:\s*[^;]*;?\s*/gi, ""
    );
    style = style.replace(/;\s*;/g, ";").replace(/;\s*$/, "").replace(/^\s*;/, "").trim();
    if (style) $(this).attr("style", style);
    else $(this).removeAttr("style");
  });

  // Consolidate spacer rows into padding
  $("tr").each(function () {
    const $tr = $(this);
    const $tds = $tr.children("td");
    if ($tds.length !== 1) return;

    const $td = $tds.first();
    const style = $td.attr("style") || "";
    const text = $td.text().trim();

    const heightMatch = style.match(/height\s*:\s*(\d+)px/i);
    if (!heightMatch) return;
    if (!/font-size\s*:\s*0/i.test(style)) return;
    if (text !== "" && text !== "\u00a0" && text !== "&nbsp;") return;

    const spacerHeight = parseInt(heightMatch[1], 10);

    const $nextTr = $tr.next("tr");
    if ($nextTr.length) {
      const $nextTd = $nextTr.children("td").first();
      if ($nextTd.length) {
        let nextStyle = $nextTd.attr("style") || "";
        const ptMatch = nextStyle.match(/padding-top\s*:\s*(\d+)px/i);
        if (ptMatch) {
          const newPt = parseInt(ptMatch[1], 10) + spacerHeight;
          nextStyle = nextStyle.replace(/padding-top\s*:\s*\d+px/i, `padding-top:${newPt}px`);
        } else {
          nextStyle = `padding-top:${spacerHeight}px;` + nextStyle;
        }
        $nextTd.attr("style", nextStyle);
        $tr.remove();
        stats.spacerRowsConsolidated++;
        return;
      }
    }

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

  // Unwrap empty spans
  $("span").each(function () {
    const style = ($(this).attr("style") || "").trim();
    const attrKeys = Object.keys($(this).get(0)?.attribs || {}).filter(k => k !== "style");
    if (!style && attrKeys.length === 0) {
      $(this).replaceWith($(this).html());
    }
  });

  // Remove trailing <br> in td
  $("td").each(function () {
    const h = $(this).html();
    if (h && h.endsWith("<br>")) $(this).html(h.slice(0, -4));
  });

  // Phase 3 - Inject head content
  const $head = $("head");

  // D365 designer meta
  if (!$('meta[type="xrm/designer/setting"]').length) {
    $head.append('\n  <meta type="xrm/designer/setting" name="type" value="marketing-designer-content-editor-document">');
    stats.d365MetaAdded++;
  }

  if (!$('meta[charset]').length && !$('meta[http-equiv="Content-Type"]').length) {
    $head.prepend('\n  <meta charset="utf-8">');
  }

  // Remove existing MSO blocks from head, inject clean one
  let headHtml = $head.html() || "";
  const origHead = headHtml;
  headHtml = headHtml.replace(/<!--\[if\s+mso\]>[\s\S]*?<!\[endif\]-->/gi, "");
  if (headHtml !== origHead) $head.html(headHtml);

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
    const $lastMeta = $head.find("meta").last();
    if ($lastMeta.length) $lastMeta.after(msoStyles);
    else $head.prepend(msoStyles);
    stats.msoHeadStylesAdded++;
  }

  // Global CSS resets + responsive
  if (!existingStyles.includes("-webkit-text-size-adjust")) {
    $head.append(`
  <style>
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; border-collapse: collapse; border-spacing: 0; }
    img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; display: block; }
    body { margin: 0; padding: 0; width: 100%; }
    div { margin: 0; padding: 0; mso-para-margin: 0; mso-margin-top-alt: 0; mso-margin-bottom-alt: 0; }
    @media only screen and (max-width: 600px) {
      .email-wrapper { width: 100% !important; }
      .stack-col { display: block !important; width: 100% !important; max-width: 100% !important; }
      .stack-col-logo { display: block !important; width: 100% !important; max-width: 100% !important; text-align: center !important; }
    }
  </style>`);
    stats.responsiveStylesAdded++;
  }

  // Phase 4 - Serialize & cleanup
  let output = $.html();

  output = output.replace(/<!DOCTYPE[^>]*>/i, "<!DOCTYPE html>");
  output = output.replace(
    /<html[^>]*>/i,
    '<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">'
  );
  output = output.replace(/\s+ses:no-track="[^"]*"/gi, "");
  output = output.replace(/\s+ses:no-track(?=[>\s])/gi, "");
  output = output.replace(/<!--\[if !mso\]><!-->([\s\S]*?)<!--<!\[endif\]-->/gi, "$1");
  output = output.replace(/<!--\[if !mso\]><!-->\s*<!--<!\[endif\]-->\s*/g, "");
  output = output.replace(/;\s*;/g, ";");
  output = output
    .replace(/(<\/table>)/gi, "$1\n")
    .replace(/(<\/tr>)/gi, "$1\n")
    .replace(/(<!--\[endif\]-->)/gi, "$1\n");
  output = output.replace(/\n{3,}/g, "\n\n");

  const inputSize = new Blob([raw]).size;
  const outputSize = new Blob([output]).size;

  return { html: output, stats, inputSize, outputSize };
}

export const statLabels = {
  // Canva cleanup
  duplicateMobileBlocksRemoved: "duplicate mobile blocks removed (single-source responsive)",
  conditionalCommentsRemovedFromBody: "conditional comments removed from body (D365 compat)",
  zeroSizeImages: "zero-size images removed (mobile placeholders)",
  preloadLinksRemoved: "link preload tags removed",
  sesNoTrackRemoved: "ses:no-track removed (invalid XHTML)",
  canvaKeywordsMetaRemoved: "Canva keywords meta removed",

  // Style cleanup
  invalidStyleProps: "invalid JS-style properties removed",
  negativeBorders: "negative border values removed",
  redundantBorderRadius: "redundant border-radius:0 removed",
  alignNull: 'align="null" removed',
  preWrapFixed: "white-space:pre-wrap removed",
  undefinedMargins: "undefined margin values removed",
  minHeightRemoved: "min-height removed from tables",
  multilinePaddingFixed: "multi-line padding values collapsed",
  marginInlineFixed: "margin-inline-start removed",
  doubleSemicolonsFixed: "double semicolons cleaned",
  dataSrcRemoved: "data-src attributes removed",
  fractionalPixelsRounded: "pixel values rounded to multiples of 4",
  relativeLineHeightsFixed: "relative line-heights → fixed px",

  // Outlook fixes
  msoLineHeightRuleAdded: "mso-line-height-rule:exactly added",
  imgDisplayBlock: "display:block added to images",
  imgBorderFixed: "border:0 added to linked images",
  msoTableSpacing: "MSO table spacing added",
  bgcolorMirrored: "bgcolor mirrored from CSS background-color",
  msoParaMarginAdded: "mso-para-margin reset added to divs",
  spacerRowsConsolidated: "spacer rows → padding",

  // D365
  d365MetaAdded: "D365 designer meta tag added",
  msoHeadStylesAdded: "MSO conditional styles injected",
  responsiveStylesAdded: "responsive CSS injected",
};
