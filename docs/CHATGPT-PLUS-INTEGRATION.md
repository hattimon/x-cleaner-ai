# ChatGPT plan usage and API providers

Open the dashboard through localhost. In **Integrations → ChatGPT Plan Usage**, choose **Continue with ChatGPT** and grant access on the OpenAI page. The first sign-in uses the local callback required by OpenAI's open-source flow. Once connected, the dashboard can use that connection over LAN and the server can refresh its saved grant for background scans. In account **Settings**, select a model and optionally allow it to run on scheduled scans. The backend serializes token refresh and attempts revocation on sign-out. [Official plan usage overview](https://developers.openai.com/siwc/token-sharing-open-source)

The installed host ID is stored in PostgreSQL. Initial OAuth uses the public `dynamic_agent_client` entry point, S256 PKCE, state and an OIDC nonce. The callback supplies an issued `oaiapp_…` client ID, used for exchange and renewal. An exact `127.0.0.1` redirect reaches the Windows loopback published by Compose. The backend accepts a short-lived receipt from the original authenticated local session before completing exchange. It verifies the ID token issuer, audience, signature, nonce and expiration using OpenAI's JWKS. [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)

Plan usage calls the public model and Responses endpoints using the OAuth credential. HTTP inference uses streaming and `store: false`. The model picker shows the service's catalog. Models or permissions may vary with the account and preview rollout. OpenAI documents a shared five-hour limit for Plus. The app checks the grant and actual model access for Free and other plans. Local rules remain available. [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference) · [Accounts and usage limits](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions) · [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

## Optional API keys

| Provider | Key page |
| --- | --- |
| OpenAI API | [API keys](https://platform.openai.com/api-keys) |
| Anthropic Claude | [API keys](https://platform.claude.com/settings/keys) |
| Google Gemini | [API keys](https://aistudio.google.com/app/apikey) |

Use **Integrations → AI API providers → Add key**. The saved key is encrypted and takes precedence over an environment key for the same provider. Select that provider and enter the model ID from its console in account **Settings**. Confirm provider billing for the account. Calls follow the configured daily limit. The provider endpoints use validated structured output. [OpenAI](https://developers.openai.com/api/docs/guides/structured-outputs) · [Anthropic](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) · [Google](https://ai.google.dev/gemini-api/docs/structured-output)

For profile classification the app sends derived scores, evidence types and allowed post IDs. Raw X posts stay in the app. Assistant questions are sent when you choose a remote model. Both flows restrict the assistant to read-only context. [X Developer Policy](https://docs.x.com/developer-terms/policy)

ChatGPT Web custom MCP and ChatGPT plan OAuth are separate capabilities. See [MCP integration](MCP-INTEGRATION.md).
