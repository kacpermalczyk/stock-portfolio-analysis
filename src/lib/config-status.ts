import { isAuthConfigured } from "@/lib/auth";

export interface ConfigStatus {
  name: string;
  configured: boolean;
  message: string;
  docsUrl?: string;
  docsLabel?: string;
}

export const configStatuses: ConfigStatus[] = [
  {
    name: "Owner login",
    configured: isAuthConfigured(),
    message: "Logowanie właściciela nie jest skonfigurowane — ustaw OWNER_EMAIL, OWNER_PASSWORD_HASH i SESSION_SECRET.",
  },
];

export const missingConfigs = configStatuses.filter((s) => !s.configured);
