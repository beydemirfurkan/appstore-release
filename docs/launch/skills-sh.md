# skills.sh

There is no submission form. skills.sh lists a public GitHub repository once its skills are installed with the `skills` CLI with telemetry on, and ranks it by installs.

1. After the release, from any empty directory:

   ```bash
   npx skills add beydemirfurkan/appstore-release --list    # should list 6 skills
   npx skills add beydemirfurkan/appstore-release -a claude-code -y
   ```

2. Check https://skills.sh/beydemirfurkan/appstore-release. The page shows the install command, the rendered `SKILL.md`, installs, stars and three security audits. `skills.sh.json` at the repository root groups the six skills into "Release pipeline" and "Focused skills".
3. The README badge is already wired: `https://skills.sh/b/beydemirfurkan/appstore-release`.

Installs with `DISABLE_TELEMETRY=1` or `DO_NOT_TRACK=1` are not counted.
