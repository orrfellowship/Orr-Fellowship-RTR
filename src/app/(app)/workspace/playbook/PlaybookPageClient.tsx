"use client";

import { useTransition } from "react";
import type { Profile } from "@/lib/types";
import PlaybookTab from "../PlaybookTab";
import type { Phase, TeamMember } from "../types";

export default function PlaybookPageClient({ phases, profile, canEdit, team, accent }: {
  phases: Phase[];
  profile: Profile;
  canEdit: boolean;
  team: TeamMember[];
  accent: string;
}) {
  const [, startTransition] = useTransition();

  const nameOf = (id: string | null, label?: string | null): string => {
    if (label === "team") return "Team";
    if (!id) return "Unassigned";
    if (id === profile.id) return "You";
    return team.find((t) => t.id === id)?.full_name ?? "—";
  };

  return (
    <PlaybookTab
      phases={phases}
      profile={profile}
      canEdit={canEdit}
      team={team}
      nameOf={nameOf}
      accent={accent}
      startTransition={startTransition}
    />
  );
}
