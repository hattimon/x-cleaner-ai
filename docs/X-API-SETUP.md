# X API setup and costs

Open **Integrations → Connect X account** to start the wizard. It keeps the X console open in a separate tab and provides values you can copy at each step.

1. Sign in to the X console and complete the **Developer Program** form with the prepared use-case description.
2. Choose **New App**. Use the suggested name and the description and use case shown in the wizard.
3. Open **User authentication settings**. Choose **Native App** and **Read**, or enable **Read and write** for individually confirmed follow and unfollow actions. Copy the exact **Callback URI / Redirect URL** and **Website URL** from the wizard.
4. Copy the OAuth 2.0 **Client ID** from **Keys and tokens**. Paste it in the wizard and select **Save and connect to X**, then approve access on X. If you already have a Client ID, use **I have a Client ID** to go straight to this step. Confidential clients can add their Client Secret under **Advanced options**. The app stores credentials encrypted on your server.

[X Developer setup](https://docs.x.com/x-api/getting-started/getting-access) · [X OAuth with PKCE](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code)

Use **Add another X account** to authorize each account separately. Switch to that account on X before approving the request. The active-account picker changes which account's profiles, settings and scans you see. Each exact dashboard address used to authorize accounts requires its own redirect entry in X. Existing connections work from the other supported dashboard addresses.

Requested scopes are `tweet.read`, `users.read`, `follows.read` and `offline.access`. To request `follows.write`, enable write access in the X console and in the wizard's **OAuth settings** step, then reconnect. After returning to **Integrations**, use **Set your limit and enable X reads** to authorize scans for the new account. The **X permissions** section distinguishes granted scopes from observed API results. Existing installations can still set OAuth defaults through environment variables.

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
