fix: wrap tmux nudge messages in a system-reminder envelope

Nudges sent with tmux `send-keys` reach the LLM as human input and can derail active polecat work (gc-239). `NudgeNow` now wraps each message as `<system-reminder>` + `gc-nudge: <message>`, the envelope UserPromptSubmit hooks already use, so the model reads a nudge as system context. Closes gc-239.

Not tested: check that nudges arrive wrapped and that an active polecat session treats them as context, not conversation.
