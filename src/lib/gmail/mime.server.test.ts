import { buildGmailMimeMessage, validateGmailTestInput, senderDisplayPhrase } from "./test-send.server";

let failures = 0;
function check(name: string, condition: boolean) {
  if (condition) console.log(`  ok  ${name}`);
  else {
    console.error(`FAIL  ${name}`);
    failures++;
  }
}

function rejects(name: string, callback: () => unknown) {
  try {
    callback();
    check(name, false);
  } catch {
    check(name, true);
  }
}

const message = buildGmailMimeMessage({
  sender: "fellow@orrfellowship.org",
  recipient: "recipient@example.com",
  subject: "One Gmail test",
  body: "Hello from the RTR Gmail test.",
});
check("MIME From carries the branded display name and address", /From: .+ <fellow@orrfellowship\.org>\r\n/.test(message.mime) && message.mime.includes("=?UTF-8?B?"));
check("sender display phrase is derived from the local part", senderDisplayPhrase("mark.stolte@orrfellowship.org") === "Mark Stolte · Orr Fellowship");
check("sender display phrase handles a single-token local part", senderDisplayPhrase("jesse@orrfellowship.org") === "Jesse · Orr Fellowship");
check("MIME contains exactly one To header", message.mime.includes("To: recipient@example.com\r\n") && message.mime.match(/^To:/gm)?.length === 1);
check("MIME contains subject and UTF-8 plain-text headers", message.mime.includes("Subject: One Gmail test\r\n") && message.mime.includes("MIME-Version: 1.0\r\n") && message.mime.includes("Content-Type: text/plain; charset=UTF-8\r\n"));
check("raw MIME uses unpadded base64url", !/[+/=]/.test(message.raw));
check("base64url decodes to the complete MIME message", Buffer.from(message.raw, "base64url").toString("utf8") === message.mime);

const unicode = buildGmailMimeMessage({
  sender: "fellow@orrfellowship.org",
  recipient: "recipient@example.com",
  subject: "Hello 👋 — résumé",
  body: "Café résumé 🚀",
});
check("UTF-8 subject is MIME encoded", unicode.mime.includes("Subject: =?UTF-8?B?"));
const decodedUnicodeMime = Buffer.from(unicode.raw, "base64url").toString("utf8");
const encodedUnicodeBody = decodedUnicodeMime.split("\r\n\r\n")[1].replace(/\r\n/g, "");
check("UTF-8 body survives both encoding layers", Buffer.from(encodedUnicodeBody, "base64").toString("utf8") === "Café résumé 🚀");

rejects("recipient header injection is rejected", () => validateGmailTestInput({ recipient: "one@example.com\r\nBcc: two@example.com", subject: "Test", body: "Body" }));
rejects("subject header injection is rejected", () => validateGmailTestInput({ recipient: "one@example.com", subject: "Test\nBcc: two@example.com", body: "Body" }));
rejects("sender header injection is rejected", () => buildGmailMimeMessage({ sender: "fellow@orrfellowship.org\r\nBcc: two@example.com", recipient: "one@example.com", subject: "Test", body: "Body" }));
rejects("comma-separated recipients are rejected", () => validateGmailTestInput({ recipient: "one@example.com,two@example.com", subject: "Test", body: "Body" }));
rejects("semicolon-separated recipients are rejected", () => validateGmailTestInput({ recipient: "one@example.com;two@example.com", subject: "Test", body: "Body" }));
rejects("empty subject is rejected", () => validateGmailTestInput({ recipient: "one@example.com", subject: " ", body: "Body" }));
rejects("empty body is rejected", () => validateGmailTestInput({ recipient: "one@example.com", subject: "Test", body: " " }));

// ---- Phase 23: attachments (multipart/mixed) --------------------------------
const pdfBytes = Buffer.from("%PDF-1.4 fake").toString("base64");
const withAtt = buildGmailMimeMessage({
  sender: "fellow@orrfellowship.org",
  recipient: "recipient@example.com",
  subject: "With attachment",
  body: "See attached.",
  attachments: [{ fileName: "Orr One-Pager.pdf", mimeType: "application/pdf", contentBase64: pdfBytes }],
});
check("attachment message is multipart/mixed", /Content-Type: multipart\/mixed; boundary="[^"]+"/.test(withAtt.mime));
check("attachment part carries the filename", withAtt.mime.includes('Content-Disposition: attachment; filename="Orr One-Pager.pdf"'));
check("attachment part declares its MIME type", withAtt.mime.includes('Content-Type: application/pdf; name="Orr One-Pager.pdf"'));
check("attachment bytes survive into the message", withAtt.mime.replace(/\r\n/g, "").includes(pdfBytes));
const bodyBoundary = withAtt.mime.match(/boundary="([^"]+)"/)?.[1] ?? "";
check("multipart message is closed with the final boundary", withAtt.mime.trimEnd().endsWith(`--${bodyBoundary}--`));
check("plain body part still present in multipart", withAtt.mime.includes("Content-Type: text/plain; charset=UTF-8"));
check("no-attachment message stays single-part", !buildGmailMimeMessage({ sender: "fellow@orrfellowship.org", recipient: "r@example.com", subject: "s", body: "b", attachments: [] }).mime.includes("multipart"));

// ---- HTML + inline emblem (multipart/related) -------------------------------
const emblemBytes = Buffer.from("fakePNG").toString("base64");
const htmlMsg = buildGmailMimeMessage({
  sender: "fellow@orrfellowship.org",
  recipient: "recipient@example.com",
  subject: "Branded",
  body: "Hello — [Learn More](https://orrfellowship.org/apply)",
  inlineEmblem: { contentId: "orr-emblem", mimeType: "image/png", contentBase64: emblemBytes },
});
check("emblem message is multipart/related", /Content-Type: multipart\/related; boundary="[^"]+"/.test(htmlMsg.mime));
check("emblem message carries an alternative part", htmlMsg.mime.includes("Content-Type: multipart/alternative;"));
check("emblem message includes plain and html parts", htmlMsg.mime.includes("Content-Type: text/plain; charset=UTF-8") && htmlMsg.mime.includes("Content-Type: text/html; charset=UTF-8"));
check("emblem part is inline with the expected Content-ID", htmlMsg.mime.includes("Content-ID: <orr-emblem>") && htmlMsg.mime.includes("Content-Disposition: inline"));
check("emblem bytes survive into the message", htmlMsg.mime.replace(/\r\n/g, "").includes(emblemBytes));
const htmlPart = Buffer.from(htmlMsg.mime.match(/text\/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/)?.[1].replace(/\r\n/g, "") ?? "", "base64").toString("utf8");
check("decoded html links to the apply page and references the emblem cid", htmlPart.includes('href="https://orrfellowship.org/apply"') && htmlPart.includes("cid:orr-emblem"));

const htmlWithAtt = buildGmailMimeMessage({
  sender: "fellow@orrfellowship.org", recipient: "r@example.com", subject: "s", body: "b",
  inlineEmblem: { contentId: "orr-emblem", mimeType: "image/png", contentBase64: emblemBytes },
  attachments: [{ fileName: "one.pdf", mimeType: "application/pdf", contentBase64: pdfBytes }],
});
check("emblem + file attachment is wrapped in multipart/mixed", htmlWithAtt.mime.includes("multipart/mixed") && htmlWithAtt.mime.includes("multipart/related") && htmlWithAtt.mime.includes('filename="one.pdf"'));

import { sanitizeAttachmentFileName } from "./test-send.server";
check("filename CRLF/quote injection is stripped", !/[\r\n"\\]/.test(sanitizeAttachmentFileName('evil\r\nContent-Type: text/html"name.pdf')));
check("empty filename falls back", sanitizeAttachmentFileName("  ") === "attachment");
check("non-ascii filename becomes header-safe", !/[^\x20-\x7E]/.test(sanitizeAttachmentFileName("résumé 🚀.pdf")));

console.log(failures === 0 ? "\nAll Gmail MIME checks passed." : `\n${failures} Gmail MIME check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
