# Claude directory: plugin bundle submission

Submit at https://claude.ai/directory/manage → **Submit new** → **Plugin bundle**. It needs a paid claude.ai plan and a connected GitHub account. Run `claude plugin validate --strict` in the repository first; it passes for v3.0.0.

**Name:** App Store Release

**Repository:** https://github.com/beydemirfurkan/appstore-release

**Short description (one line):**
Ship an iOS app to App Store review from Claude: a readiness report, an idempotent listing pipeline and the submission, over the App Store Connect API.

**Description:**
App Store Release takes an iOS app all the way to App Store review through the App Store Connect API. It starts from a readiness report: a verdict (ready, blocked, needs-human, in-review, rejected, live) and an ordered plan, where every finding says whether the tool can fix it or only App Store Connect's web UI can. An idempotent pipeline then writes the listing: build, metadata in every locale, price, content rights, age rating, category, review details, release timing, screenshots through the new App Asset Library (including iPhone Duo), and subscriptions. Submit refuses unless the report says ready, and it sends new subscriptions in the same submission as the version.

The plugin bundles nine skills (a router plus focused ones for an offline preflight of the app, screenshots, age rating, subscriptions and purchases, rejections, signing credentials, TestFlight and customer reviews) and an MCP server with 13 outcome-shaped tools. It has no dependencies and nothing to install. Credentials come from the environment and never appear in tool arguments. Every write needs explicit confirmation, `--dry-run` is enforced in the HTTP client, and certificate slots are never spent without asking.

Updated for iOS 27 and App Store Connect API 4.5.1. MIT licensed. Not affiliated with Apple.

**Example prompts:**

- "Publish my app for review."
- "Why can't I submit this version?"
- "Upload the new screenshots, including iPhone Duo."
- "Apple rejected 1.2. Help me fix it and resubmit."

**Category:** Developer tools

**Permissions it needs:** network access to api.appstoreconnect.apple.com; Node.js 20.11+; an App Store Connect API key (App Manager role) provided through environment variables.
