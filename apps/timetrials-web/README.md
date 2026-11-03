# Web

The browser application renders public profiles, Time Trials, Tournament management, and the account flow. It consumes the `/v1` API, shared catalogue IDs, rules and design tokens; it has no database access. Configuration enters through the build/runtime boundary documented in the root operations guide. Change a page in `src/`, then run `npm ci`, `npm run typecheck`, `npm test`, `npm run build` and the affected real-browser route. Generated benchmark data comes from the reviewed seed and catalogue generator. The API is its provider.
