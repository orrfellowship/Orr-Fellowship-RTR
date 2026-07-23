import assert from "node:assert/strict";
import {
  findUnsupportedOutreachVariables,
  findManualPlaceholders,
  renderOutreachTemplate,
  normalizeOutreachMergeVariables,
  splitName,
  parseClassYear,
  candidateOutreachTokens,
} from "./candidate-tokens";

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) { console.log(`  ok  ${name}`); return; }
  failures++; console.log(`FAIL  ${name}`);
}

// splitName
check("splits a full name", splitName("Catherine Mazanek").first === "Catherine" && splitName("Catherine Mazanek").last === "Mazanek");
check("single name has empty last", splitName("Jesse").first === "Jesse" && splitName("Jesse").last === "");
check("keeps multi-part last names", splitName("Jordan Lee Caracci").last === "Lee Caracci");
check("empty name is safe", splitName(null).first === "" && splitName("  ").first === "");

// parseClassYear
check("pulls year from 'May 2027'", parseClassYear("May 2027") === "2027");
check("pulls year from an ISO date", parseClassYear("2026-05-15") === "2026");
check("falls back to raw when no year", parseClassYear("Spring") === "Spring");
check("empty grad date → empty", parseClassYear(null) === "" && parseClassYear("") === "");

// findUnsupportedOutreachVariables
check("accepts all supported tokens", findUnsupportedOutreachVariables("Hi {{candidate_first_name}} at {{school}} ({{class_year}}) — {{stage}}, {{fellow_point_person}}").length === 0);
check("keeps legacy tokens valid for saved templates", findUnsupportedOutreachVariables("Hi {{first_name}} {{full_name}} — {{point_person}}").length === 0);
check("flags a typo'd token", findUnsupportedOutreachVariables("Hi {{frist_name}}").includes("{{frist_name}}"));
check("flags a malformed variable", findUnsupportedOutreachVariables("Hi {{first_name}").includes("Malformed merge variable"));
check("normalizes legacy tokens to their new names", normalizeOutreachMergeVariables("Hi {{ first_name }} {{last_name}} {{full_name}} — {{POINT_PERSON}}") === "Hi {{candidate_first_name}} {{candidate_last_name}} {{candidate_full_name}} — {{fellow_point_person}}");

// findManualPlaceholders — [single brackets] must be filled in before sending
check("finds a single-bracket placeholder", findManualPlaceholders("Hi {{first_name}}, from [Your Name]").includes("[Your Name]"));
check("finds multiple, de-duplicated", (() => { const p = findManualPlaceholders("[X] and [Y] and [X]"); return p.length === 2 && p.includes("[X]") && p.includes("[Y]"); })());
check("ignores {{merge_fields}}", findManualPlaceholders("Hi {{first_name}} at {{school}}").length === 0);
check("clean template has none", findManualPlaceholders("Hi there, thanks for your time.").length === 0);

// rendering
const tokens = candidateOutreachTokens({
  name: "Catherine Mazanek", stage: "Contacted", gradDate: "May 2027",
  school: "IU Indianapolis", pointPerson: "Mark Stolte",
});
check("tokens derive candidate first/last/full", tokens.candidate_first_name === "Catherine" && tokens.candidate_last_name === "Mazanek" && tokens.candidate_full_name === "Catherine Mazanek");
check("tokens carry school/stage/class_year/fellow_point_person", tokens.school === "IU Indianapolis" && tokens.stage === "Contacted" && tokens.class_year === "2027" && tokens.fellow_point_person === "Mark Stolte");
check("renders a full template", renderOutreachTemplate("Hi {{candidate_first_name}}, you're at {{school}} ('{{class_year}}). — {{fellow_point_person}}", tokens) === "Hi Catherine, you're at IU Indianapolis ('2027). — Mark Stolte");
check("still renders legacy aliases", renderOutreachTemplate("Hi {{first_name}} ({{full_name}}) — {{point_person}}", tokens) === "Hi Catherine (Catherine Mazanek) — Mark Stolte");
check("leaves an unknown token literal (caught earlier at preview)", renderOutreachTemplate("Hi {{mystery}}", tokens) === "Hi {{mystery}}");
check("uses the SPECIFIC school string it is given (never a group label)", tokens.school !== "Satellite School");

assert.equal(failures, 0);
console.log(failures === 0 ? "\nAll candidate-token checks passed." : `\n${failures} candidate-token check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
