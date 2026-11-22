/** Independent reads for Needs attention, including explicit partial-result failures. */

import type { JiraClient } from "./client";
import { JiraError } from "./http";
import { LIST_FIELDS } from "./parse";
import { type IssueQuery, jql } from "./query";

const TIMED_FIELDS = [...LIST_FIELDS, "updated"];
const WORK_FIELDS = [...TIMED_FIELDS, "duedate", "issuelinks"];

type Check<T> = { label: string } & PromiseSettledResult<T>;

/** Expired credentials fail the whole read; other failures leave the other checks usable. */
async function check<T>(label: string, request: Promise<T>): Promise<Check<T>> {
  try {
    return { label, status: "fulfilled", value: await request };
  } catch (reason) {
    if (reason instanceof JiraError && reason.status === 401) throw reason;
    return { label, status: "rejected", reason };
  }
}

export async function readAttention(
  source: Pick<JiraClient, "search" | "mentions">,
  query: IssueQuery,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const open = { ...query, status: "open" } satisfies IssueQuery;
  const showOpen = query.status !== "done";
  const options = { signal };
  const [work, flagged, mentioned, created, assigned] = await Promise.all([
    showOpen ? check("Open issues", source.search(jql(open), WORK_FIELDS, query.limit + 1, options)) : undefined,
    showOpen
      ? check("Flagged issues", source.search(jql(open, "flagged = Impediment"), WORK_FIELDS, query.limit + 1, options))
      : undefined,
    check("Mentions", source.mentions(jql(query, "updated >= startOfDay(-1)"), query.limit, signal)),
    check(
      "Changes to your issues",
      source.search(
        jql(query, "(creator = currentUser() OR reporter = currentUser())", "updated >= startOfDay(-1)"),
        TIMED_FIELDS,
        query.limit + 1,
        options,
      ),
    ),
    showOpen
      ? check(
          "Assigned issues",
          source.search(jql(open, "assignee = currentUser()"), TIMED_FIELDS, query.limit + 1, options),
        )
      : undefined,
  ]);
  signal?.throwIfAborted();
  const checks = [work, flagged, mentioned, created, assigned].filter((result) => result !== undefined);
  const failures = checks.filter((result) => result.status === "rejected");
  const first = failures[0];
  if (first && failures.length === checks.length) throw first.reason;
  return {
    work: work?.status === "fulfilled" ? work.value : [],
    flagged: flagged?.status === "fulfilled" ? flagged.value : [],
    mentioned: mentioned.status === "fulfilled" ? mentioned.value : { issues: [], more: false, scanned: 0 },
    created: created.status === "fulfilled" ? created.value : [],
    assigned: assigned?.status === "fulfilled" ? assigned.value : [],
    warnings: failures.map(({ label }) => `${label} unavailable`),
  };
}
