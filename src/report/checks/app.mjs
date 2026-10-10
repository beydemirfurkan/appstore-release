// The app itself — its Info.plist, privacy manifest and code — as the offline
// preflight read it. The reading happens in getReadinessReport (it touches the
// disk); this check only reports it, so buildReport stays pure.

export const section = { id: "app", title: "App" };

/** @param {{ snapshot: any }} input */
export function check({ snapshot }) {
  return snapshot.preflight?.findings ?? [];
}
