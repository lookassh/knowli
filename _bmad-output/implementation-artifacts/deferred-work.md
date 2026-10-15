- source_spec: _bmad-output/implementation-artifacts/spec-picture-choice-grid.md
  summary: Verify whether deployed Kid clients that support picture vocabulary but cap prompts at three options can resume sessions after rollout of four choices.
  evidence: The server checks only supportsPictureVocabulary; no deployment inventory established whether a client with the old three-option schema remains active. Confirm deployed browser or mobile client versions and their session-resume behavior before rollout.
