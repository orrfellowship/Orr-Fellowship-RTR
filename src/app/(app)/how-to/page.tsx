import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { isAdminPlus, isSuper } from "@/lib/types";

const C = {
  navy: "#11123E", navy2: "#485F92", canvas: "#F4F6FB",
  line: "#E1E5EE", gray: "#33384D", grayMute: "#6E7385", orange: "#E8743B",
};
const HEAD = "'Cabin', sans-serif";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, padding: "22px 26px", marginBottom: 16 }}>
      <h2 style={{ fontFamily: HEAD, fontSize: 19, color: C.navy, margin: "0 0 12px" }}>{title}</h2>
      <div style={{ fontSize: 14.5, color: C.gray, lineHeight: 1.65 }}>{children}</div>
    </div>
  );
}

function Step({ children }: { children: React.ReactNode }) {
  return <li style={{ marginBottom: 6 }}>{children}</li>;
}

export default async function HowToPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const admin = isAdminPlus(profile.role);
  const sup = isSuper(profile.role);
  const home = admin ? "/console" : "/workspace";

  void home;
  return (
    <div style={{ maxWidth: 880, margin: "0 auto", padding: "30px 28px 80px" }}>
        <h1 style={{ fontSize: 30, color: C.navy, margin: "0 0 4px" }}>Welcome to Orr Recruiting</h1>
        <p style={{ color: C.grayMute, margin: "0 0 24px", fontSize: 15 }}>
          A quick guide to getting around. You're signed in as <b style={{ color: C.gray }}>{profile.full_name}</b> ({profile.role.replace("_", " ")}).
        </p>

        <Section title="Signing in & your password">
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <Step>Only people invited by an admin can sign in. You sign in with your <b>email and password</b>.</Step>
            <Step>First time here? Open the invite email and click the link to set your password.</Step>
            <Step>Forgot it? On the login screen choose <b>Forgot password?</b> to get a reset link.</Step>
            <Step>Use the <b>Sign out</b> button (top right) to switch accounts.</Step>
          </ul>
        </Section>

        <Section title="Finding your way around">
          <p style={{ marginTop: 0 }}>The tabs across the top are your main navigation:</p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {admin ? (
              <>
                <Step><b>Overview</b> — program-wide pipeline snapshot.</Step>
                <Step><b>Candidates</b> — every candidate, with filtering, sorting, résumés, and school routing.</Step>
                <Step><b>Standings</b> — how schools stack up across goals, funnel, and yield.</Step>
                <Step><b>Schools</b> — schools, tiers, and goals.</Step>
                <Step><b>Calendar</b> — recruiting events, organization-wide or per school (see below).</Step>
                <Step><b>Playbook</b> — the recruitment plan and tasks per school (or group).</Step>
                <Step><b>Resources</b> — shared docs, links, and assets for the team.</Step>
                {sup ? (
                  <>
                    <Step><b>Users</b> — invite people and set roles/schools.</Step>
                    <Step><b>Sync</b> — pull candidates from JazzHR and run maintenance jobs.</Step>
                  </>
                ) : (
                  <Step><b>Review Sync</b> — match incoming JazzHR candidates to sourced ones.</Step>
                )}
              </>
            ) : (
              <>
                <Step><b>Weekly Snapshot</b> — your pipeline numbers, the tasks assigned to you, and the recruiting calendar.</Step>
                <Step><b>My School</b> — your school's candidate board.</Step>
                <Step><b>Standings</b> — how schools stack up across the program.</Step>
                <Step><b>Candidates</b> — browse candidates and open résumés.</Step>
                <Step><b>Playbook</b> — your team's recruitment plan and tasks.</Step>
                <Step><b>Resources</b> — shared docs and links for the team.</Step>
              </>
            )}
          </ul>
        </Section>

        <Section title="Candidates — finding candidates">
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <Step><b>Search</b> by name, email, or major in the filter bar.</Step>
            <Step><b>Filter</b> by school, major, stage, minimum GPA, or Favorites only. Hit <b>Clear</b> to reset.</Step>
            <Step><b>Sort</b> by clicking a column header (Candidate, School, Major, GPA, Stage). Click again to reverse.</Step>
            <Step>Open a candidate to view details and their <b>résumé</b> inline.</Step>
            {admin && <Step>Set or fix a candidate's <b>school</b> right from the row. Satellite and Bonus schools are grouped into single options.</Step>}
          </ul>
        </Section>

        <Section title="Importing candidates">
          <p style={{ marginTop: 0 }}>Anyone can bulk-import. Use the <b>Bulk import</b> button on the Candidates tab. You can add candidates three ways:</p>
          <ul style={{ margin: "0 0 12px", paddingLeft: 20 }}>
            <Step><b>Upload</b> a <b>.csv</b> or <b>.xlsx</b> file.</Step>
            <Step><b>Paste</b> rows copied straight from Excel or Google Sheets into any cell.</Step>
            <Step><b>Type</b> directly into the grid, adding rows as needed.</Step>
          </ul>
          <p style={{ margin: 0 }}>You only provide <b>Name, Email, and School</b> — stage, GPA, and major flow in automatically from JazzHR:</p>
          <pre style={{ background: C.canvas, border: `1px solid ${C.line}`, borderRadius: 8, padding: "12px 14px", fontSize: 12.5, overflowX: "auto", margin: "8px 0 0" }}>
{`Name,Email,School
Jane Doe,jane@example.com,Purdue`}
          </pre>
          <p style={{ marginBottom: 0 }}>The header row is auto-detected and schools are matched by name. Possible duplicates (same email) are flagged before you import.</p>
        </Section>

        <Section title="Working a candidate — outreach, warm intros & résumé">
          <p style={{ marginTop: 0 }}>Click any candidate on the Candidates page to open their detail panel:</p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <Step><b>Outreach log</b> — record every touchpoint (calls, emails, meetings, follow-ups). Use the quick buttons or write your own note so the whole team can see the history.</Step>
            <Step><b>Warm intros</b> — log who on the team has a connection to this candidate and how they know them, so the best person can make the ask.</Step>
            <Step><b>Résumé</b> — opens the candidate's résumé inline. The first view fetches it; after that it loads instantly.</Step>
            <Step>You can view outreach and warm intros for <b>any</b> candidate, but you can only add to the ones <b>assigned to you</b> (where you're the point person).</Step>
          </ul>
          <p style={{ marginBottom: 0, marginTop: 12, padding: "10px 14px", background: "#FBE7DF", border: `1px solid ${C.orange}`, borderRadius: 9 }}>
            <b>Résumé not loading?</b> If you see a "session expired," "not mapped," or any other résumé error, contact <b>Mark Stolte</b> (markstolte02@gmail.com) — it usually means the JazzHR connection needs a refresh on the admin side.
          </p>
        </Section>

        <Section title="Playbook & weekly tasks">
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <Step>The <b>Playbook</b> is your team's recruitment plan, organized by role and month.</Step>
            <Step>Your <b>Weekly Snapshot</b> lists only the tasks assigned to <b>you</b> — check them off as you go.</Step>
            <Step>Tasks assigned to the whole team or left unassigned are managed by team leads and admins in the Playbook tab.</Step>
            <Step>Satellite and Bonus schools share <b>one</b> playbook for the whole group.</Step>
          </ul>
        </Section>

        <Section title="Recruiting calendar & events">
          <p style={{ marginTop: 0 }}>Your <b>Weekly Snapshot</b> shows a calendar of your school's events plus any organization-wide events. There are two kinds:</p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <Step><b>Show-up events</b> — things to attend. You'll be asked to <b>RSVP</b> (Going / Can't make it).</Step>
            <Step><b>Info / deadlines</b> — dates to know about; no RSVP.</Step>
          </ul>
          <p style={{ marginBottom: 0, marginTop: 12 }}>Click any event to see its <b>date, address</b> (with a map link), <b>description</b>, and who's going.</p>
          {(admin || profile.role === "team_lead") && (
            <ul style={{ margin: "12px 0 0", paddingLeft: 20 }}>
              {admin ? (
                <>
                  <Step>In the <b>Calendar</b> tab, click <b>+ Add event</b> (or any day) and pick a <b>scope</b>: <b>Organization-wide</b> (shows on everyone's snapshot) or a <b>specific school</b>.</Step>
                  <Step>Add a title, date, type, address, and description so it's more than a dot on the calendar.</Step>
                </>
              ) : (
                <Step>As a team lead you can <b>add events</b> for your school right from the snapshot calendar — click <b>+ Add event</b> or any day, then add a title, date, type, address, and description.</Step>
              )}
            </ul>
          )}
        </Section>

        {admin && (
          <Section title="Admin — users & roles">
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              <Step>In <b>Users</b>, click <b>+ Invite User</b> for one person, or <b>Bulk invite</b> to paste a list (Email, Name, Role, School).</Step>
              <Step>Each person gets an invite email and sets their own password.</Step>
              <Step>Change anyone's role or school inline; remove a user with the × button.</Step>
              <Step>Roles: <b>fellow</b> (own school), <b>team lead</b> (manages the team's playbook), <b>admin</b> / <b>super admin</b> (full access).</Step>
            </ul>
          </Section>
        )}

        {sup && (
          <Section title="Super admin — JazzHR sync & résumés">
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              <Step><b>Step 1–2</b>: check the connection and pull candidates.</Step>
              <Step><b>Step 3</b>: re-route any unrouted candidates after updating school matching.</Step>
              <Step><b>Step 4</b>: remove duplicate candidates by email.</Step>
              <Step><b>Step 5</b>: sync résumé IDs so résumés can be viewed inline (re-run after a big candidate sync).</Step>
              <Step>If résumés say "session expired," refresh the <code style={{ background: C.canvas, padding: "1px 5px", borderRadius: 4 }}>JAZZHR_SANDCASTLE_TICKET</code> environment variable.</Step>
            </ul>
          </Section>
        )}

        <Section title="Need help?">
          <p style={{ margin: 0 }}>If something looks off or you need access you don't have, reach out to an Orr program admin.</p>
        </Section>
    </div>
  );
}
