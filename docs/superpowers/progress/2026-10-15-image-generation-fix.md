# Image generation provider regression

Root-cause evidence:
- Coolify lists `UMIEM_IMAGE_SIZE` for the live Knowli app; the connector intentionally never reveals values.
- The current local `.env` sets `UMIEM_IMAGE_SIZE=512x512`; live image model falls back to `gpt-image-1` because no `UMIEM_IMAGE_MODEL` key is configured.
- OpenAI image API currently accepts 1024x1024, 1024x1536, 1536x1024, or auto, so 512x512 causes provider HTTP 400. Current worker logs collapse that into `code=provider`.
- This establishes a likely production misconfiguration, but Coolify value itself is not available for verification.

Checklist:
- [x] Read using-superpowers, systematic-debugging, test-driven-development, using-git-worktrees and requesting-code-review skills.
- [x] Inspect current deployment/branch and preserve unrelated changes in the primary checkout.
- [x] Isolated worktree from current origin/main; dependencies installed with frozen lockfile; targeted image-provider baseline 3/3 PASS.
- [x] Add regression tests and observe expected RED before implementation (512x512 default model; then 1536x864 custom-size model after review surfaced the model-specific edge).
- [x] Normalize unsupported OpenAI image size in effective media settings (shared by fingerprint and request) and warn without secrets.
- [x] Update provider configuration docs and run targeted/full verification.
- [x] Obtain independent review of full diff; resolve the Important model-specific finding with a second RED-GREEN cycle.
- [x] Obtain final independent review after documenting recovery for already-failed immutable assets (Critical 0, Important 0, Minor 0).
- [x] Final verification and create fix PR to main; do not merge or alter live Coolify settings.

Implementation and verification evidence:
- RED: 512x512 with the default `gpt-image-1` initially remained unchanged; after normalization, 12 config tests passed.
- Review-driven RED: 1536x864 for `gpt-image-2` initially incorrectly fell back to 1024x1024; model-aware allowlist fixed it and config tests passed.
- Final broad run after the final docs-only note: unit 116 files / 1118 tests PASS, typecheck PASS, build PASS, `git diff --check` PASS. Independent reviewer reran config, image adapter, and fingerprint suites: 3 files / 21 tests PASS.
- Review: final independent review of full diff against 0050c384, 0 Critical / 0 Important / 0 Minor. The reviewer's earlier operational note is documented: retrying a failed old asset does not update its size; regenerate illustration or re-edit draft to trigger reconciliation.
- API/DTO/database/MCP/skill impact: none; configuration behavior only. No live provider request or deployment was performed. Production Coolify environment values remain unreadable via the available read-only connector, so the suspected live `512x512` value is not directly confirmed.
