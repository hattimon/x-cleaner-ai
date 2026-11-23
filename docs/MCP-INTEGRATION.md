# Optional MCP integration

Set `MCP_ENABLED=true` in `.env` and run `docker compose up -d backend`. From **Integrations → Local MCP**, create a key for the active X account. The key expires after 30 days and can be revoked. The optional preparation scope permits analysis and cleanup previews. A live scan can consume X credits already authorized in account settings.

Start the standard I/O server from a local MCP client. Pass `MCP_TOKEN` through the client's protected environment. For a Compose client launched from the project directory, use the argument sequence below.

```text
docker compose exec -T -e MCP_TOKEN backend node dist/server/mcp-stdio.js
```

Available operations include listing the scoped account, dashboard summary, scan status, candidates, protected profiles, analysis and audit types. The preparation scope adds `start_analysis_scan` and `prepare_cleanup_review`. The SDK validates schemas. Every authenticated tool call is audited and every use rechecks the key. The server publishes no port.

ChatGPT Web needs an eligible plan, a supported remote MCP transport and a connected authenticated endpoint. OpenAI documents a Secure MCP Tunnel for eligible private services. This version offers local stdio. The current OpenAI plan documentation does not list Plus for custom MCP server connections. [OpenAI Help Center](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt)
