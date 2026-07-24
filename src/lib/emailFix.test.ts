import { isValidEmail, suggestEmailFix, findMalformedEmails } from "./emailFix";

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  ${name}`);
  else { console.error(`FAIL  ${name}`); failures++; }
}

// isValidEmail
check("accepts a normal email", isValidEmail("sam.jones@gmail.com"));
check("rejects a missing @", !isValidEmail("sam.jones.gmail.com"));
check("rejects a missing TLD", !isValidEmail("sam@gmail"));
check("rejects spaces", !isValidEmail("sam jones@gmail.com"));
check("rejects empty", !isValidEmail("") && !isValidEmail(null));

// suggestEmailFix
check("fixes .con → .com", suggestEmailFix("sam@gmail.con") === "sam@gmail.com");
check("fixes a misspelled domain", suggestEmailFix("sam@gmial.com") === "sam@gmail.com");
check("fixes a missing dot before com", suggestEmailFix("sam@gmailcom") === "sam@gmail.com");
check("collapses a double @", suggestEmailFix("sam@@gmail.com") === "sam@gmail.com");
check("collapses double dots", suggestEmailFix("sam@gmail..com") === "sam@gmail.com");
check("returns null when it can't repair", suggestEmailFix("not-an-email") === null);
check("returns null for an already-valid address", suggestEmailFix("sam@gmail.com") === null);
check("does not clobber a real .co domain", suggestEmailFix("sam@brumley.co") === null);

// findMalformedEmails
const cands = [
  { id: "1", name: "A", email: "a@gmail.com" },
  { id: "2", name: "B", email: "b@gmail.con" },
  { id: "3", name: "C", email: null },
  { id: "4", name: "D", email: "  " },
];
check("flags only the malformed non-empty emails", (() => { const m = findMalformedEmails(cands); return m.length === 1 && m[0].id === "2"; })());

console.log(failures === 0 ? "\nAll emailFix checks passed." : `\n${failures} emailFix check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
