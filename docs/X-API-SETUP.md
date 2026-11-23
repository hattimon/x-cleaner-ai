# X API setup and costs

Open **Integrations → Connect X account**. For the first connection, create an application in the [X Developer Console](https://console.x.com/) and enable OAuth 2.0 user authentication. A Native App is a public client and needs its Client ID. Register the exact redirect shown in the dialog, then paste the Client ID and click **Save and connect to X**. Confidential clients can add their Client Secret under **X app options**. Credentials are stored encrypted on your server. [X OAuth with PKCE](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code)

Use **Add another X account** to authorize each account separately. Switch to that account on X before approving the request. The active-account picker changes which account's profiles, settings and scans you see. Each exact dashboard address used to authorize accounts requires its own redirect entry in X. Existing connections work from the other supported dashboard addresses.

Requested scopes are `tweet.read`, `users.read`, `follows.read` and `offline.access`. To request `follows.write`, enable write access in the X console and in **X app options**, then reconnect. The **X permissions** section distinguishes granted scopes from observed API results. Existing installations can still set OAuth defaults through environment variables.

## Published limits and listed rates

X documents prepaid, usage-based API billing. These reference rates were checked on 23 November 2026. The Developer Console determines actual availability, credits and cost.

| Operation | Published limits | Listed base rate |
| --- | --- | --- |
| `GET /2/users/me` | 75 per user per 15 minutes | $0.010 per user resource |
| `GET /2/users/:id/following` | 300 per app and user per 15 minutes | $0.010 per resource, or $0.001 for qualifying owned reads |
| `GET /2/users/:id/tweets` | 10,000 per app and 900 per user per 15 minutes | $0.005 per returned third-party post |
| `DELETE /2/users/:source/following/:target` | 50 per user per 15 minutes | $0.010 per delete request |
| `POST /2/users/:id/following` | 50 per user per 15 minutes | $0.015 per creation request |

The owned-read discount requires the authenticated account, owner of the developer app and requested user ID to match. X documents 24-hour UTC deduplication. The application conservatively reserves the nominal amount at the standard rate based on requested page or sample size. This reservation can exceed the final X charge. An X 429 retains the scan cursor and respects provider headers. [X pricing](https://docs.x.com/x-api/getting-started/pricing) · [X rate limits](https://docs.x.com/x-api/fundamentals/rate-limits)

The panel shows that approving the X connection may charge for an identity lookup. Scan reads have separate per-account consent and limits in Settings. One profile confirmation authorizes one follow or unfollow. The application follows the X restriction on bulk or indiscriminate follow changes. [X automation rules](https://help.x.com/en/rules-and-policies/x-automation)

The free archive workflow accepts official account and following files. They identify the profiles which appeared in the export. This workflow supports browse, search, protection, manual decisions and reporting. Timelines and relationship interaction data can be unavailable. [Request your X archive](https://help.x.com/en/managing-your-account/how-to-download-your-x-archive)
