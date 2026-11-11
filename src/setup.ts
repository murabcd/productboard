import { PROVIDER_NAMES } from "./agent/models";
import {
  AGENT_PROVIDERS,
  type AgentProvider,
  agentProviderOverride,
  readConfig,
  reuseAgentKey,
  saveAgentKey,
  saveCredentials,
  validateJiraField,
} from "./auth";
import { JiraClient } from "./jira/client";
import { type Credentials, JiraError, JiraHttp } from "./jira/http";
import { DEFAULT_THEME, type ThemeId } from "./theme";
import type { Screen } from "./ui/screen";

const JIRA_TOKEN_PAGE = "https://id.atlassian.com/manage-profile/security/api-tokens";
const AGENT_KEY_PAGES: Record<AgentProvider, string> = {
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://platform.claude.com/settings/keys",
};
const URL_SCHEME = /^https?:\/\//i;
const URL_PATH = /\/.*$/;
const jiraSite = (site: string): string => site.replace(URL_SCHEME, "").replace(URL_PATH, "").toLowerCase();

export async function connectJira(screen: Pick<Screen, "prompt">): Promise<Credentials | undefined> {
  const saved = readConfig();
  const theme = saved?.theme ?? DEFAULT_THEME;
  const title = "Connect Jira";
  const site = await screen.prompt(
    {
      title,
      field: {
        label: "Jira Cloud site",
        hint: "For example, your-team.atlassian.net",
        value: saved?.site,
        submit: (value) => {
          const host = jiraSite(value);
          validateJiraField("site", host);
          return host;
        },
      },
    },
    theme,
  );
  if (site === undefined) return;
  const email = await screen.prompt(
    {
      title,
      field: {
        label: "Atlassian account email",
        value: saved?.email,
        submit: (value) => {
          validateJiraField("email", value);
          return value;
        },
      },
    },
    theme,
  );
  if (email === undefined) return;
  return screen.prompt(
    {
      title,
      field: {
        label: "Jira API token",
        hint: "Choose Create API token on Atlassian’s token page.",
        url: JIRA_TOKEN_PAGE,
        secret: true,
        submit: async (token, signal) => {
          validateJiraField("token", token);
          const candidate = { site, email, token };
          await verifyJira(candidate, signal);
          signal.throwIfAborted();
          saveCredentials(candidate);
          return candidate;
        },
      },
    },
    theme,
  );
}

async function verifyJira(credentials: Credentials, signal: AbortSignal): Promise<void> {
  const http = new JiraHttp(credentials);
  const cancel = () => http.close();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    await new JiraClient(http).myself();
  } catch (error) {
    if (error instanceof JiraError) {
      if (error.status === 401 || error.status === 403) {
        throw new Error("Jira rejected the sign-in. Check your email and token.");
      }
      if (error.status === 429) throw new Error("Jira is rate-limiting requests. Try again in a minute.");
    }
    throw new Error("Could not connect to Jira. Try again.");
  } finally {
    signal.removeEventListener("abort", cancel);
    http.close();
  }
}

export async function connectAgent(
  screen: Pick<Screen, "prompt">,
  theme: ThemeId,
  mode: "first-run" | "explicit" = "explicit",
): Promise<boolean> {
  if (mode === "first-run" && reuseAgentKey()) return true;
  const override = agentProviderOverride();
  const providers = override ? [override] : AGENT_PROVIDERS;
  const choices = providers.map((provider) => ({
    value: provider,
    label: PROVIDER_NAMES[provider],
    detail: "",
  }));
  const provider =
    override && mode === "explicit"
      ? override
      : await screen.prompt<AgentProvider | null>(
          {
            title: "Connect an integration",
            choices:
              mode === "first-run"
                ? [...choices, { value: null, label: "Skip for now", detail: "Jira only" }]
                : choices,
          },
          theme,
        );
  if (!provider) return false;
  return (
    (await screen.prompt(
      {
        title: `Connect ${PROVIDER_NAMES[provider]}`,
        field: {
          label: "API key",
          url: AGENT_KEY_PAGES[provider],
          secret: true,
          submit: (key) => {
            saveAgentKey(provider, key);
            return true;
          },
        },
      },
      theme,
    )) ?? false
  );
}
