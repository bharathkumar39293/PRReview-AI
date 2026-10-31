# PRReview AI

Gemini-powered review of committed Git diffs. Requires Node.js 22+ and Git on PATH. Repository content is uploaded only when `--allow-upload` is supplied for that invocation.

```sh
npm install
npm run build
npm test
npm run dev -- review --base HEAD~1
npm start -- review --repo /path/to/repo --base main --head HEAD --format json
# After inspecting the commit range and configuring Gemini:
npm run dev -- review --repo /path/to/repo --base main --allow-upload
```

Copy `.env.example` to `.env` if desired. Set `GEMINI_API_KEY` and `GEMINI_MODEL` to your own credentials and a model supporting structured JSON output; no model is assumed. Both are required only for a nonempty, eligible, approved AI request. Never commit credentials. Configuration is loaded from the CLI working directory, not from `--repo`.

`MAX_DIFF_BYTES` defaults to 1048576. `MAX_AI_INPUT_BYTES` defaults to 131072 and measures UTF-8 bytes of the serialized eligible-file payload, system instruction and response schema. Both accept positive integers up to 100000000. Oversized inputs fail before client initialization and are never truncated; choose a smaller commit range. Byte limits bound request input, not exact token usage or monetary cost. Requests have a 60-second timeout, an 8192-token output cap and no automatic retries. Rate limits and provider failures produce sanitized errors.

`--base` is required. `--head` defaults to HEAD, `--repo` to the current directory, and `--format` to markdown. Comparisons use the two commit endpoints, not merge-base semantics or uncommitted changes. Empty diffs and diffs with no eligible files succeed without initializing Gemini. Invalid repositories/references, oversized diffs, missing AI configuration for a real request and invalid provider responses fail with exit code 1.

Without `--allow-upload`, the command produces a local metadata report explaining how to approve an upload. It never initializes the Gemini client or calls the API. With approval, only eligible text patches are sent to Google Gemini. Sensitive paths, binary files, unsafe paths and files without extracted patches are excluded. **Filename-based filtering cannot catch all secrets: secrets embedded in ordinary source files may still be transmitted. Inspect the selected commit range before approving.** Approval applies only to the current invocation.

Markdown and JSON reports include repository and requested/resolved commit references, file statistics, model used (or null when skipped), review summary, findings grouped by severity, suggestions, confidence and rejected-finding count. Reports omit full source patches. Both state that findings are AI-generated hypotheses, not confirmed bugs, and that tests were not executed by the review. Markdown escapes untrusted text.

Gemini is asked for structured JSON using a minimal schema derived from the review Zod schema: types, object properties, required fields, array items and enums. Draft metadata and extra scalar constraints (including Zod's implicit maximum safe integer) are omitted from the provider-facing schema to reduce compatibility and constrained-decoding risks. The full strict Zod schema, positive safe-integer checks, nonempty text checks and semantic validation remain local. Response text is still parsed and validated locally. Each finding must reference an exact eligible path and an added new-side line from a zero-context hunk. Absolute/traversal paths, invented files and lines, sensitive/binary files and deleted-only anchors are rejected and counted. Invalid JSON or schema-invalid responses fail the entire review. An empty findings array is a valid outcome.

Gemini failures show the phase (`request-creation`, `api-execution` or `response-parsing`), HTTP status and canonical provider status when available, and a sanitized provider message from recognized API error envelopes. Unknown transport/SDK messages, header/body dumps, response text and raw JSON/Zod errors are withheld. Known submitted source text and credentials are redacted before message truncation. HTTP status is unavailable for local/parsing failures when the SDK supplies no status. API-execution covers the SDK's asynchronous request, including transport failures. Token-limit and blocked outputs have distinct errors rather than being mislabeled as API failures. No fallback to unstructured output, truncation of input or automatic retry is performed.

Sensitive files have metadata only and zero content statistics; binary detection is unavailable for excluded files. The Git diff limit applies to extracted non-sensitive patches in aggregate and individual Git outputs, including file listings. Submodules are ignored. Pure renames without content changes have no eligible patch to upload.

Security: Git runs via execFile with fixed argument arrays, literal pathspecs, external diff/text conversion disabled, and optional writes disabled. No target scripts are run and no target files are written. Rewrite-aware rename detection helps identify sensitive files moved over existing paths; rename patches compare exact blobs to prevent adjacent sensitive renames leaking through reused paths. This is still Git similarity detection, not reliable secret tracking across arbitrary rewrites or copies. Source content remains untrusted. The system instruction tells Gemini to ignore instructions embedded in source; no tools are supplied, and automatic function calling is disabled. Prompt instructions cannot guarantee model correctness; local semantic validation checks locations, not the truth of a finding. API errors never expose raw SDK messages, credentials or request bodies.

The AI provider, analysis, Git extraction, semantic validation and report modules remain separate. Automated tests mock the Gemini SDK and use temporary Git repositories; they do not make real provider requests. Real model availability, authentication and review quality require a separately approved live run.
