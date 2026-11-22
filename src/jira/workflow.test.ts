import { expect, test } from "bun:test";
import { rawIssue } from "../testing";
import { toIssue } from "./parse";
import { Workflow, workflowStage } from "./workflow";

test("custom and localized names fall back to Jira categories, including done Icebox and Blocked statuses", () => {
  expect(workflowStage({ status: "К выполнению", category: "new" })).toBe("To do");
  expect(workflowStage({ status: "В работе", category: "indeterminate" })).toBe("In progress");
  for (const status of ["Готово", "Icebox", "Blocked", "QA Blocked"])
    expect(workflowStage({ status, category: "done" })).toBe("Done");
  expect(workflowStage({ status: "Unblocked", category: "indeterminate" })).toBe("In progress");
});

test("site mappings reach parsed issues and preserve the original status", () => {
  const workflow = Workflow.parse({ statuses: { "На проверке": "In review", "Ожидает релиза": "Ready for release" } });
  const raw = rawIssue("TEAM-42", "indeterminate");
  raw.fields.status.name = "НА ПРОВЕРКЕ";
  expect(toIssue(raw, workflow)).toMatchObject({ status: "НА ПРОВЕРКЕ", stage: "In review" });
  const parsed = toIssue(raw, workflow);
  expect(workflowStage(parsed)).toBe("In review");
  expect(workflowStage({ ...parsed, category: "done" })).toBe("Done");
  expect(workflowStage({ status: "Ожидает релиза", category: "indeterminate" }, workflow)).toBe("Ready for release");
  expect(Workflow.safeParse({ statuses: { Custom: "unknown" } }).success).toBe(false);
});
