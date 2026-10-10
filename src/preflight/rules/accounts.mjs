// Accounts: 4.8 Login Services and 5.1.1(v) Account Sign-In.

import { APPLE_LOGIN_PACKAGES, AUTH_PACKAGES, SOCIAL_LOGIN_PACKAGES } from "../data.mjs";
import { appFinding, hasAny, locate, Severity } from "./util.mjs";

const SIGN_UP = /\b(signUp|sign_up|createUser(WithEmailAndPassword)?|registerUser|createAccount)\b/;
const DELETE_ACCOUNT =
  /delete[\s_-]?account|deleteAccount|deleteUser|account[\s_-]?deletion|removeAccount|closeAccount/i;
const GOOGLE_PROVIDER = /expo-auth-session\/providers\/google/;

/** @param {import("../project.mjs").Project} project */
export function accounts(project) {
  const out = [];
  const social = SOCIAL_LOGIN_PACKAGES.filter((p) => project.deps.has(p));
  const googleViaAuthSession = locate(project, GOOGLE_PROVIDER);
  if (
    (social.length || googleViaAuthSession) &&
    !hasAny(project, APPLE_LOGIN_PACKAGES) &&
    !locate(project, /ASAuthorizationAppleIDProvider/)
  ) {
    out.push(
      appFinding({
        id: "app.login.equivalent-option",
        guideline: "4.8",
        severity: Severity.WARNING,
        title: "Third-party login without an equivalent private option",
        detail:
          `Found ${[...social, ...(googleViaAuthSession ? ["expo-auth-session Google provider"] : [])].join(", ")}. ` +
          "Guideline 4.8 asks apps that use a third-party or social login for the primary account to also offer a login " +
          "that limits data to name and email, lets people keep their email private, and does not track for ads. " +
          "Exempt: your own account system only, education/enterprise accounts, government ID, or a client for a specific third-party service.",
        fix: "Add Sign in with Apple (expo-apple-authentication), which meets all three — or record why an exemption applies.",
        ...(googleViaAuthSession ? { location: googleViaAuthSession } : {}),
      }),
    );
  }

  const signUp = locate(project, SIGN_UP);
  if (hasAccounts(project) && !locate(project, DELETE_ACCOUNT)) {
    out.push(
      appFinding({
        id: "app.account-deletion",
        guideline: "5.1.1(v)",
        severity: Severity.WARNING,
        title: "Accounts can be created, but nothing in the code deletes one",
        detail:
          '"If your app supports account creation, you must also offer account deletion within the app." ' +
          "This is a text search for a deletion path; it cannot see a server-side flow.",
        fix: "Add an in-app way to delete the account (not just sign out), and list it in the App Review notes.",
        ...(signUp ? { location: signUp } : {}),
      }),
    );
  }
  return out;
}

/** People can have an account in this app: an auth library, or sign-up code. @param {import("../project.mjs").Project} project */
export const hasAccounts = (project) => hasAny(project, AUTH_PACKAGES) || Boolean(locate(project, SIGN_UP));
