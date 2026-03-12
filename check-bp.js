const fs = require("fs");
const cheerio = require("cheerio");
const html = fs.readFileSync("email.txt", "utf-8");
const $ = cheerio.load(html);

$("table[class]").each(function () {
  const cls = $(this).attr("class") || "";
  if (cls.includes("under")) {
    const bp = cls.match(/under-(\d+)/);
    console.log(`${cls} -> breakpoint: ${bp ? bp[1] : "none"}px`);
  }
});
