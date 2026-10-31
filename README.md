# PRReview AI

**A read-only TypeScript CLI that reviews committed Git diffs using Google Gemini and validates AI-generated findings against actual changed lines.**

PRReview AI analyzes changes between two Git commits, asks an LLM to identify potential issues, and checks whether each reported finding refers to an eligible changed file and an added line.

It is designed to make AI-assisted code review more constrained and verifiable—not to replace human review or claim that every finding is a confirmed bug.

## Why PRReview AI?

AI-generated code reviews can produce problems of their own:

- Findings that reference files that were never changed.
- Line numbers that do not exist in the diff.
- Speculative issues with little actionable value.
- Accidental exposure of sensitive files.
- Unclear errors when an LLM request fails.

PRReview AI addresses some of these problems by separating AI analysis from local validation.

## How it works

```text
Git repository
      |
      v
Extract committed diff
      |
      v
Classify changed files
      |
      +---- Sensitive / binary / unsafe files
      |              |
      |              v
      |         Excluded
      |
      v
Check diff and AI input limits
      |
      v
Explicit upload approval
      |
      v
Google Gemini analysis
      |
      v
Structured JSON response
      |
      v
Zod schema validation
      |
      v
File and added-line validation
      |
      v
Markdown / JSON report
```

## Features

- **Committed-diff review:** Compare two Git commit references.
- **Gemini integration:** Analyze eligible code changes using Google Gemini.
- **Structured output:** Request JSON findings and validate them locally with Zod.
- **Finding validation:** Reject findings that reference unknown files, unsafe paths, or lines outside added-line ranges.
- **Sensitive-file filtering:** Exclude files identified by filename-based sensitivity rules.
- **Binary-file exclusion:** Do not send binary file contents to the model.
- **Explicit upload approval:** No Gemini request is made unless `--allow-upload` is supplied.
- **Configurable limits:** Enforce Git diff and AI input size limits before making a request.
- **Multiple report formats:** Generate Markdown or JSON reports.
- **Read-only operation:** Do not modify the target repository or execute its scripts.

## Requirements

- Node.js 22 or later
- Git installed and available on your `PATH`
- A Google Gemini API key for AI-powered reviews

## Getting started

### 1. Clone the repository

```bash
git clone https://github.com/bharathkumar39293/PRReview-AI.git
cd PRReview-AI
```

### 2. Install dependencies

```bash
npm ci
```

### 3. Build and run tests

```bash
npm run build
npm test
```

The automated test suite uses mocked AI responses and temporary Git repositories. It does not require a Gemini API key or make live API requests.

## Configure Gemini

Create a `.env` file in the PRReview AI project directory, using `.env.example` as a reference.

```env
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
```

Get your API key from [Google AI Studio](https://aistudio.google.com/app/apikey).

Use your own API key. Never commit it or share it in logs, screenshots, or public issues.

The CLI loads configuration from its current working directory—not from the target repository passed through `--repo`.

## Usage

### Review without uploading code

```bash
npm run dev -- review --repo /path/to/repository --base main
```

This produces a local metadata report. It does not initialize the Gemini client or send repository content to the API.

### Run an AI-powered review

```bash
npm run dev -- review --repo /path/to/repository --base main --head HEAD --allow-upload
```

The `--allow-upload` flag explicitly approves sending eligible diff content to Google Gemini for that invocation.

### Generate JSON output

```bash
npm run dev -- review --repo /path/to/repository --base main --head HEAD --format json --allow-upload
```

### Available options

| Option | Description |
|---|---|
| `--repo` | Target Git repository. Defaults to the current directory. |
| `--base` | Base commit reference. Required. |
| `--head` | Head commit reference. Defaults to `HEAD`. |
| `--format` | Report format: `markdown` or `json`. |
| `--allow-upload` | Explicitly approve sending eligible diff content to Gemini. |

## Finding validation

Gemini is instructed to return structured findings containing:

- File path
- Line number
- Severity: critical, high, medium, or low
- Category: bug, security, performance, error handling, or missing test
- Title and description
- Suggested fix
- Confidence level

PRReview AI does not trust these references automatically.

Each finding is independently checked to ensure that:

1. Its file exists in the eligible changed-file set.
2. Its path is not absolute, unsafe, or a traversal path.
3. Its file is not excluded as sensitive or binary.
4. Its line number falls within an added-line range in the diff.

Invalid findings are rejected and counted in the report.

These checks validate the location and structure of a finding. They do **not** prove that the reported issue is a real bug.

## Safety and privacy

PRReview AI is designed to avoid unnecessary repository exposure.

- Without `--allow-upload`, no Gemini API request is made.
- With approval, only eligible text patches are sent to Google Gemini.
- Sensitive paths, binary files, unsafe paths, and files without eligible patches are excluded.
- Full source patches are not included in generated reports.
- The target repository is not modified.
- Repository scripts are not executed.
- Git operations use fixed argument arrays rather than shell command construction.
- Gemini is not given tool or function-calling access.

**Important limitations:**

- Sensitive-file detection relies on filename-based heuristics. It cannot reliably detect secrets embedded inside ordinary source files.
- Review the commit range and eligible changes before approving an upload.
- Sending code to Gemini is subject to Google's API terms and data-handling policies.
- AI-generated findings can be incorrect, incomplete, or speculative.

## Limits and failure handling

PRReview AI applies configurable limits to Git diff output and serialized AI input.

| Setting | Default |
|---|---:|
| `MAX_DIFF_BYTES` | 1 MiB |
| `MAX_AI_INPUT_BYTES` | 128 KiB |
| Request timeout | 60 seconds |
| Maximum generated output | 8,192 tokens |

Limits must be positive integers and cannot exceed 100 MB.

Oversized inputs fail before the request is made. The tool does not silently truncate the diff or retry indefinitely.

Provider errors, response-parsing failures, blocked output, and invalid structured responses are handled as distinct failure cases where possible. Diagnostic output is sanitized to avoid exposing credentials and raw request content.

## Reports

Reports include:

- Repository and commit references
- Changed-file statistics
- AI model used, when applicable
- Review summary
- Findings grouped by severity
- Suggested fixes and confidence levels
- Rejected-finding count
- A disclaimer that findings are AI-generated hypotheses

The report also states that tests were not executed by the review.

## Current limitations

PRReview AI currently:

- Reviews committed Git changes only.
- Compares two commit endpoints; it does not implement merge-base pull-request semantics.
- Does not review uncommitted working-tree changes.
- Does not execute tests or independently reproduce reported bugs.
- Does not guarantee detection of all vulnerabilities or defects.
- Does not guarantee that every valid issue will be identified by the model.

An empty findings list does not mean the reviewed code is bug-free.

## Testing

Run the automated suite:

```bash
npm test
```

The tests cover Git diff extraction, sensitive and binary file handling, upload approval, mocked Gemini responses, structured-output validation, invalid paths and line references, and report generation.

Automated tests do not establish live provider availability or real-world review accuracy. Those require separate live API and controlled evaluation runs.

## Project structure

```text
src/
  ai/          Gemini client and analysis
  git/         Git diff extraction
  review/      Review orchestration and validation
  reports/     Markdown and JSON report generation
  cli/         Command-line interface

tests/         Automated tests
examples/      Example review material
```

## Design principle

**Let the model suggest. Let deterministic code validate. Let humans decide.**

PRReview AI uses an LLM to identify potential issues while keeping file eligibility, line-reference checks, upload approval, and report generation under local programmatic control.

---

Built with TypeScript, Node.js, Google Gemini, Zod, and Git.

**Repository:** https://github.com/bharathkumar39293/PRReview-AI
