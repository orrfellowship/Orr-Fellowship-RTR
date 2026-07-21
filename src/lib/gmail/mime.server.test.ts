import { buildGmailMimeMessage, validateGmailTestInput } from "./test-send.server";

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
check("MIME contains the required From header", message.mime.includes("From: fellow@orrfellowship.org\r\n"));
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

import { sanitizeAttachmentFileName } from "./test-send.server";
check("filename CRLF/quote injection is stripped", !/[\r\n"\\]/.test(sanitizeAttachmentFileName('evil\r\nContent-Type: text/html"name.pdf')));
check("empty filename falls back", sanitizeAttachmentFileName("  ") === "attachment");
check("non-ascii filename becomes header-safe", !/[^\x20-\x7E]/.test(sanitizeAttachmentFileName("résumé 🚀.pdf")));

console.log(failures === 0 ? "\nAll Gmail MIME checks passed." : `\n${failures} Gmail MIME check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
