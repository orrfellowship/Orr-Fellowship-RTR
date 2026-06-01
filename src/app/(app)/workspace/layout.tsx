import { getWorkspaceContext } from "./data";
import WorkspaceNav from "./WorkspaceNav";
import { C } from "./constants";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { profile, school, groupName } = await getWorkspaceContext();
  const accent = school?.color_primary ?? C.orange;

  return (
    <div style={{ minHeight: "100vh", background: C.canvas }}>
      <WorkspaceNav
        school={school}
        groupName={groupName}
        fullName={profile.full_name}
        role={profile.role}
        accent={accent}
      />
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "30px 28px 80px" }}>
        {children}
      </div>
    </div>
  );
}
