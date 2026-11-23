# Architecture

Nginx serves a React 19, Vite and Tailwind dashboard and forwards same-origin requests to Fastify. Zod validates configuration, OAuth callbacks, provider contracts, app input and structured AI output. TypeScript DTOs describe the REST responses. Prisma and PostgreSQL 17 store sessions, provider credentials, account profiles, scan snapshots, preferences, approvals and audit history.

The standalone DCC target starts the same services as an unprivileged container user. It generates the database password and encryption key in its named volume and binds PostgreSQL to the container's loopback.

The backend runs the scheduler in the same process. A partial unique index admits one unfinished job per account. PostgreSQL leases and row locking claim one page or profile at a time. Each committed page records its cursor and profile IDs before advancing. A renewed worker can use the existing state after a restart. Completed list traversal is required before a profile is marked as missing from the following list. Paused jobs keep their position, and 429 responses defer to the upstream reset or retry time.

X OAuth, archive import and provider adapters are independent of classification. Cached samples use bounded retention. Public post and reply dates establish confirmed activity. Missing, restricted or partial data route to unknown or review. The current classification cannot bypass owner preferences, the allowlist or evidence freshness. AI can downgrade recommendations and identify source IDs drawn from the provided sample.

## Score meanings

| Field | Interpretation |
| --- | --- |
| Confidence | Evidence strength from 0 to 100. Owner overrides reflect an explicit owner decision. |
| Inactivity | Strength of confirmed inactivity relative to the configured threshold. Use the activity category to distinguish missing evidence. |
| Spam | Concentration of repeated text, engagement bait, suspicious promotions or misleading financial claims in the sample. |
| Quality | Signals of original analysis, education or constructive argument in the sample. |
| Relationship | Strength of an owner preference or manual protection. Zero can mean no accessible evidence. |
| Completeness | Availability and reliability of the sampled timeline. |

Cleanup previews are persisted. Confirmation rechecks ownership, token scope, eligibility, allowlists and previous uncertain results. Each validated confirmation reserves one operation before making the X call. Ambiguous outcomes require a fresh scan or manual review. MCP and the assistant do not expose X writes.

Language selection is local to each browser. English is the default and Polish is an explicitly selectable locale. Statements from X and provider evidence are treated as data. Versioned prompts live under `prompts/`. The interfaces in `server/future-automation.ts` define extension points for publishing, engagement, intelligence and agents.
