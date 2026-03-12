const fs = require("fs");
const cheerio = require("cheerio");
const file = process.argv[2] || "email.optimized.txt";
const html = fs.readFileSync(file, "utf-8");
const $ = cheerio.load(html);

// Find max nesting depth of tables
function getDepth(el, depth) {
  let max = depth;
  $(el)
    .children()
    .each(function () {
      const d = $(this).is("table") ? depth + 1 : depth;
      max = Math.max(max, getDepth(this, d));
    });
  return max;
}
console.log("Max table nesting depth:", getDepth("body", 0));
console.log("Total tables:", $("table").length);

// Find single-cell passthrough tables
let passthrough = 0;
let passthroughDetails = [];
$("table").each(function (i) {
  const rows = $(this).find("> tbody > tr");
  if (rows.length === 1) {
    const cells = rows.first().find("> td");
    if (cells.length === 1) {
      const cell = cells.first();
      const childTables = cell.children("table");
      const otherChildren = cell
        .contents()
        .filter(function () {
          return !($(this).is("table") || (this.type === "text" && !$(this).text().trim()));
        });
      if (childTables.length === 1 && otherChildren.length === 0) {
        const outerStyle = $(this).attr("style") || "";
        const cellStyle = cell.attr("style") || "";
        const combined = outerStyle + ";" + cellStyle;
        const hasMeaningful =
          /background|padding[^:]|border(?!-collapse|-spacing)/i.test(combined);
        if (!hasMeaningful) {
          passthrough++;
          passthroughDetails.push({
            tableIndex: i,
            outerStyle: outerStyle.substring(0, 80),
            cellStyle: cellStyle.substring(0, 80),
          });
        }
      }
    }
  }
});

console.log("\nPassthrough tables (1 row, 1 cell, 1 child table, no key styles):", passthrough);
passthroughDetails.forEach((d) => {
  console.log(`  table#${d.tableIndex} | table-style: "${d.outerStyle}" | td-style: "${d.cellStyle}"`);
});

// Empty rows with no real content
let emptyRows = 0;
$("tr").each(function () {
  const cells = $(this).find("> td");
  if (cells.length === 1) {
    const inner = cells.first().html();
    if (inner !== null && inner.trim() === "") {
      emptyRows++;
    }
  }
});
console.log("\nCompletely empty rows:", emptyRows);

// Find the <br><br> only content tables
$("td").each(function (i) {
  const inner = $(this).html();
  if (inner && /^(\s|<br\s*\/?>|&nbsp;)*$/i.test(inner.trim()) && inner.trim().length > 0) {
    const depth = $(this).parents("table").length;
    console.log(
      `\nWhitespace-only td#${i} (depth ${depth}): "${inner.trim().substring(0, 60)}"`
    );
  }
});
