# Building the Swiss Transit Explorer with mcp-use

This is a candid, step‑by‑step account of how we built a ChatGPT app for Swiss public transit using mcp-use. It covers what we did first, what we changed along the way, the hurdles we hit, and how the final app behaves.

[IMAGE PLACEHOLDER: chat-test-run.gif]

## Goals

- Provide **decision‑ready** routing, not just raw timetables.
- Rank options by **risk** (tight transfers, delays, weather exposure).
- Keep tool calls **efficient** to reduce token usage and external API load.
- Render results as **ChatGPT widgets** (route explorer + station boards).
- Support optional **weather** and **GTFS line mapping** without forcing them.

## Phase 1: Project setup

1. Started from `create-mcp-use-app` (Apps SDK template).
2. Removed the ecommerce demo widgets and replaced them with:
   - `transit-route-explorer`
   - `departures-board`
3. Kept the inspector workflow for rapid iteration.
4. Confirmed local dev server + widget rendering worked in the inspector.

[IMAGE PLACEHOLDER: tools-overview.png]

## Phase 2: Core tools (connections + station boards)

We implemented the base tools against `transport.opendata.ch`:

- `find_connections`: core routing query.
- `get_departures`: live departure board.
- `get_arrivals`: live arrival board.
- `check_disruptions`: station‑level disruption scan.
- `check_route_delays`: route‑specific delays + station disruptions.
- `get_route_weather`: destination weather summary.

We intentionally kept tools **narrow and composable** so the model could call exactly what it needed without bloating responses.

[IMAGE PLACEHOLDER: get_departures.png]

## Phase 3: Decision layer (risk + ranking)

Raw connections were not enough, so we added a decision layer to rank options and attach explanations.

### Key additions

- **Reliability scoring** (transfer penalties, tight margins, peak time, current delays).
- **Risk levels**: low / medium / high derived from reliability and exposure.
- **Walk + exposure accounting** to penalize long walks or outdoor time.
- **Buffer handling** for arrive‑by requests.

This is the layer that converts raw data into a decision‑ready summary.

[IMAGE PLACEHOLDER: find_connections_widget.png]

## Phase 4: Optional weather integration

We integrated Open‑Meteo, but made it **explicitly optional**:

- Weather is fetched only when `includeWeather` is requested.
- The main tool remains small and fast for standard routing.
- Weather becomes a constraint (exposure), not a decorative detail.

This reduced token size and avoided unnecessary API calls.

[IMAGE PLACEHOLDER: check_route_weather.png]

## Phase 5: GTFS line mapping

We had raw line IDs like `004816`. Users need to see `IR 16`, `S11`, `IC 5`, etc.

We added GTFS mapping:

1. Download static GTFS from opentransportdata.swiss.
2. Build a lookup file (`trip_id → route_id → short/long name`).
3. Attach `lineDisplay`, `lineType`, and `operator`.

This dramatically improved readability and credibility.

[IMAGE PLACEHOLDER: exclamation-mark-for-platform-change-this-is-why-we-use-gtfs.png]

## Phase 6: UI refinement

Early UI attempts were overloaded. We simplified aggressively:

- Removed redundant tags (fastest / recommended / fewest transfers).
- Replaced percentage reliability with a single **risk pill**.
- Removed weather background color to avoid “judgmental” UI.
- Aligned time rows even when a platform was missing.
- Updated wording: “Risk scores based on transfers, transfer time, and delays.”

These changes made the interface calmer and more decision‑focused.

[IMAGE PLACEHOLDER: find_connections_config.png]

## Phase 7: Tool routing + prompt alignment

We saw incorrect tool selection and missing parameters. To fix this:

- Added a **single routing prompt** (`template_router`) that maps natural language to tool parameters.
- Made max transfers, buffers, arrive‑by, and detail level explicit mappings.
- Reduced extra prompts to avoid confusion.

Example mappings:
- “arrive by 09:10” → `isArrivalTime = true`, `datetime = 09:10`
- “max 1 transfer” → `maxTransfers = 1`
- “full details” → `detailLevel = full`
- “what should I wear” → `get_route_weather`

This improved tool usage without over‑prompting.

[IMAGE PLACEHOLDER: prompts-overview.png]

## Phase 8: Performance + token hygiene

We hit context‑length errors and excessive output. Fixes included:

- Making weather **optional** rather than default.
- Keeping tool descriptions concise.
- Returning **compact** legs by default, with `detailLevel = full` on demand.
- Removing unnecessary tools (`search_stations`) that added overhead.

[IMAGE PLACEHOLDER: maximum-tokens-reached.png]

## Phase 9: Deployment hurdles

Deployment was the most time‑consuming part.

### GitHub deployment failed

**Issue:** `mcp-use deploy` failed to clone due to missing GitHub app installation.

**Fix:** Use `mcp-use deploy --from-source` to deploy from local artifacts.

[IMAGE PLACEHOLDER: deployment-from-github-repo-issue.png]

### Widget assets missing in production

**Issue:** Widgets worked locally, but asset paths returned 404 in production.

**Fix:** Ensure `mcp-use build` runs **before** `mcp-use start`. We updated the `start` script to run a full build first.

[IMAGE PLACEHOLDER: inspector-dev-widget-not-found.png]

### ESM import errors

**Issue:** Production errors like `ERR_MODULE_NOT_FOUND` for internal imports.

**Cause:** ESM requires explicit file extensions.

**Fix:** Add `.js` to internal import paths.

[IMAGE PLACEHOLDER: server-error-chatGPT.png]

### Vite websocket noise

**Issue:** Dev widget websocket errors in inspector.

**Fix:** Non‑blocking; we treated them as dev-only and focused on production build correctness.

[IMAGE PLACEHOLDER: vite-errors.png]

## Final outcome

The final app delivers:

- **Ranked connections** with reasons.
- **Risk pills** (low / medium / high) instead of a noisy percentage.
- **Buffer‑aware suggestions** for arrive‑by requests.
- **Optional weather advice** and **GTFS line names**.
- **Two widgets**: route explorer + station board.

This matches the detailed README and the final UI state.

[IMAGE PLACEHOLDER: chat-find_connections.png]

## Feedback for the mcp-use team

- GitHub deployment error messaging should guide users to install the GitHub app or use `--from-source`.
- Widget asset diagnostics could be more explicit when assets aren’t served.
- Dev websocket errors should note when they are safe to ignore.
- Add guidance on prompt/token size limits for complex toolchains.

## What we would do next

- Add rate‑limiting and caching for transport API calls.
- Auto‑refresh GTFS lookup on a schedule.
- Add explicit transfer‑time warnings in the UI.
- Document deployment troubleshooting in the README.

## Summary

We built a Swiss public transit ChatGPT app with mcp-use that prioritizes clarity and decision‑making. Along the way we simplified the UI, improved tool routing, fixed deployment issues, and validated that the app works end‑to‑end with widgets in ChatGPT.

[IMAGE PLACEHOLDER: mcp-use-deployment.png]
