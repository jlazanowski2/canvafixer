const fs = require("fs");
const cheerio = require("cheerio");
const html = fs.readFileSync("email.optimized.txt", "utf-8");
const $ = cheerio.load(html);

console.log("=== Duplicate desktop/mobile blocks ===\n");

$("table[class]").each(function () {
  const cls = $(this).attr("class");
  const style = $(this).attr("style") || "";
  const displayMatch = style.match(/display\s*:\s*(\w+)/i);
  const display = displayMatch ? displayMatch[1] : "default";
  const text = $(this).text().trim().substring(0, 80);
  const outerHtmlLen = $.html($(this)).length;
  console.log(`class="${cls}"`);
  console.log(`  display: ${display}`);
  console.log(`  HTML size: ${(outerHtmlLen / 1024).toFixed(1)} KB`);
  console.log(`  text preview: "${text}"`);
  console.log();
});

// Calculate total size of hidden mobile blocks
let mobileSize = 0;
let desktopSize = 0;
$("table[class]").each(function () {
  const cls = $(this).attr("class") || "";
  const size = $.html($(this)).length;
  if (cls.includes("under")) {
    mobileSize += size;
  } else {
    desktopSize += size;
  }
});

const totalSize = Buffer.byteLength(html, "utf-8");
console.log("=== Size impact ===");
console.log(`Desktop blocks: ${(desktopSize / 1024).toFixed(1)} KB`);
console.log(`Mobile duplicates: ${(mobileSize / 1024).toFixed(1)} KB`);
console.log(`Total email: ${(totalSize / 1024).toFixed(1)} KB`);
console.log(`Mobile dupes are ${((mobileSize / totalSize) * 100).toFixed(1)}% of total size`);
