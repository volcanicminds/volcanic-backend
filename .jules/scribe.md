## 2024-05-05 - llms.txt consolidation

**Learning:** The repository previously had both `llms.txt` (Italian) and `llms-en.txt` (English). As per the maintainer's instruction, the English one is now the single source of truth and expanded with strict AI directives.
**Action:** Enforced pure ESM (`NodeNext`), Fastify v5, and Node.js v24+ constraints at the top of the AI context.

## 2024-05-05 - Undocumented limits and env vars in README

**Learning:** The configuration table in `README.md` was missing `AUTH_CODE_SIZE` and `MFA_APP_NAME` which are used inside the source code.
**Action:** Added them to the Environment Variables reference table in `README.md`.
