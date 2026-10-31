Run against a repository with at least two commits:

```sh
npm run dev -- review --repo /path/to/repo --base HEAD~1 --format json
```

Without `--allow-upload`, both formats show local metadata and approval instructions. Neither includes full patches. Sensitive files appear as metadata only.

After setting `GEMINI_API_KEY` and `GEMINI_MODEL` in your environment or local `.env`, explicitly approve a Gemini review:

```sh
npm run dev -- review --repo /path/to/repo --base HEAD~1 --allow-upload --format markdown
```

This sends eligible diff content to Google Gemini for this invocation. Filename-based filtering cannot catch secrets embedded in ordinary source files. Inspect the commit range before approving. Findings are hypotheses; this command does not execute tests or repository code. Empty diffs and diffs without eligible text patches make no AI request.
