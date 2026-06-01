export type Cand = {
  id: string; jazz_id: string | null; name: string; email: string | null; stage: string | null;
  gpa: string | null; area_of_study: string | null; linkedin: string | null;
  resume_link: string | null; point_person_id: string | null;
  not_interested: boolean; is_favorite: boolean;
};
export type School     = { id: string; name: string; color_primary: string | null; logo_url: string | null };
export type AllSchool  = { id: string; name: string; tier: string; color_primary: string | null; logo_url: string | null };
export type AllCand    = { id: string; name: string; email: string | null; school_id: string | null; stage: string | null; gpa: string | null; area_of_study: string | null; jazz_id: string | null; linkedin: string | null };
export type AllGoal    = { school_id: string; goal_sourced: number; goal_contacted: number; goal_applied: number };
export type TeamMember = { id: string; full_name: string; role?: string | null };
export type Task       = {
  id: string; text: string; assignee_id: string | null; assignee_label: string | null;
  month_label: string | null; notes: string | null; due_date: string | null; done: boolean;
};
export type Phase      = { id: string; label: string; title: string; sort_order: number; playbook_tasks: Task[] };
