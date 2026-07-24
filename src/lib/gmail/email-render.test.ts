import { renderOutreachHtml, renderOutreachPlainText, parseBodySegments } from "./email-render";

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  ${name}`);
  else { console.error(`FAIL  ${name}`); failures++; }
}

// ---- parseBodySegments -------------------------------------------------------
const segs = parseBodySegments("Hi, see [Learn More](https://orrfellowship.org/apply) or https://x.com now");
check("splits text and links in order", segs.length === 5 && segs[0].kind === "text" && segs[1].kind === "link" && segs[3].kind === "link");
check("captures markdown link label + url", segs[1].kind === "link" && segs[1].label === "Learn More" && segs[1].url === "https://orrfellowship.org/apply");
check("captures a bare url as its own label", segs[3].kind === "link" && segs[3].label === "https://x.com" && segs[3].url === "https://x.com");

// ---- renderOutreachHtml ------------------------------------------------------
const html = renderOutreachHtml("Hi {{first_name}},\nApply: [Learn More](https://orrfellowship.org/apply)", { emblemCid: "orr-emblem" });
check("embeds the emblem via cid when provided", html.includes('src="cid:orr-emblem"'));
check("renders a markdown link as an anchor to the right url", html.includes('<a href="https://orrfellowship.org/apply"') && html.includes(">Learn More</a>"));
check("converts newlines to <br>", html.includes("<br>"));
check("leaves merge tokens for later substitution", html.includes("{{first_name}}"));
check("omits the emblem img when no cid is given", !renderOutreachHtml("Hello", {}).includes("cid:"));

const escaped = renderOutreachHtml("5 < 6 & <script>alert(1)</script>", {});
check("escapes html-special characters in body text", escaped.includes("5 &lt; 6 &amp;") && escaped.includes("&lt;script&gt;") && !escaped.includes("<script>"));

const badLink = renderOutreachHtml("[x](javascript:alert(1))", {});
check("never emits an anchor to a non-http scheme", !/href="[^"]*javascript/i.test(badLink) && !badLink.includes("<a "));

// ---- renderOutreachPlainText -------------------------------------------------
check("flattens a markdown link to 'label (url)'", renderOutreachPlainText("See [Learn More](https://a.co/apply) today") === "See Learn More (https://a.co/apply) today");
check("leaves a bare url untouched", renderOutreachPlainText("Go to https://a.co now") === "Go to https://a.co now");
check("leaves plain text untouched", renderOutreachPlainText("Just words here") === "Just words here");

console.log(failures === 0 ? "\nAll email-render checks passed." : `\n${failures} email-render check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
