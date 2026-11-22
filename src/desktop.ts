/** macOS links and clipboard, shared by setup and the dashboard. */

import { clean } from "./text";

export const desktop = {
  open: (url: string) => run(["open", url]),
  copy: (text: string) => run(["pbcopy"], text),
};

async function run(command: string[], input?: string): Promise<void> {
  const child = Bun.spawn(command, {
    stdin: input === undefined ? "ignore" : new Blob([input]),
    stdout: "ignore",
    stderr: "pipe",
    timeout: 5000,
  });
  if ((await child.exited) !== 0) {
    const error = clean((await new Response(child.stderr).text()).trim());
    throw new Error(error || "Could not open the link");
  }
}
