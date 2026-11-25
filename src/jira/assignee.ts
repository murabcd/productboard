/** Account identities and filter semantics shared by Jira queries and saved scopes. */
import { z } from "zod";
import { clean } from "../text";

export const AssigneePerson = z.object({
  id: z.string().min(1),
  label: z.string().transform((label) => clean(label)),
});
export const AssigneeFilter = z.object({
  mode: z.enum(["include", "exclude"]),
  people: z
    .array(AssigneePerson)
    .transform((people) => [...new Map(people.map((person) => [person.id, person])).values()]),
});
export type AssigneeFilter = z.infer<typeof AssigneeFilter>;
export type AssigneePerson = z.infer<typeof AssigneePerson>;

export const ALL_ASSIGNEES: AssigneeFilter = { mode: "include", people: [] };

export function sameAssignees(a: AssigneeFilter, b: AssigneeFilter): boolean {
  if (!a.people.length && !b.people.length) return true;
  const ids = new Set(a.people.map((person) => person.id));
  return (
    a.mode === b.mode &&
    ids.size === new Set(b.people.map((person) => person.id)).size &&
    b.people.every((person) => ids.has(person.id))
  );
}
