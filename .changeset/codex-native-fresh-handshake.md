---
"@runfusion/fusion": patch
---

summary: Admit protected Codex tasks through a native session handshake before sending their first request.
category: fix
dev: Codex 0.154.0 uses a supervised stdio transport and fenced awaiting-file accounting; pending ownership and usage are reaffirmed before dispatch; protected resume remains unavailable.
