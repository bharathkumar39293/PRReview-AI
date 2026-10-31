# PRReview AI

**A read-only, Gemini-powered code review CLI that validates AI-generated findings against actual Git changes.**

PRReview AI analyzes committed Git diffs to identify potential bugs and security issues before a pull request is opened.

It combines Google Gemini's code analysis capabilities with deterministic local validation to ensure that reported findings reference eligible changed files and valid added-line locations.

The goal is simple: make AI-assisted code reviews more constrained, transparent, and verifiable.

**Built with:** TypeScript · Node.js · Google Gemini · Zod · Git

---

## Why PRReview AI?

AI-generated code reviews introduce their own reliability problems:

- Findings that reference files that were never changed.
- Line numbers that do not exist in the submitted diff.
- Speculative issues with little actionable value.
- Accidental exposure of sensitive repository files.
- Unclear behavior when an AI provider returns malformed or unexpected responses.

PRReview AI addresses these problems by separating AI analysis from deterministic local validation.

The model suggests potential issues. The application validates their structure and locations. Developers decide whether the findings represent actual bugs.

## How it works

```text
         Git Repository
                |
                v
       Extract Committed Diff
                |
                v
        Classify Changed Files
                |
          +-----+------+
          |            |
          v            v
      Eligible      Excluded
       Files      Sensitive / Binary
          |
          v
    Enforce Input Limits
          |
          v
   Explicit Upload Approval
          |
          v
     Google Gemini API
          |
          v
    Structured AI Response
          |
          v
      Zod Validation
          |
          v
  Independent Finding Checks
          |
          v
    Markdown / JSON Report
```

## Features

### AI-powered code review
- Analyze committed Git changes using Google Gemini.
- Identify potential bugs, security vulnerabilities, and other code quality issues.
- Return structured findings with severity, category, description, suggested fix, and confidence.

### Independent finding validation
- Validate reported file paths against eligible changed files.
- Reject absolute paths, unsafe paths, and path traversal attempts.
- Verify that referenced files are not excluded as sensitive or binary.
- Check that finding line numbers fall within added-line ranges.
- Count rejected findings separately.

### Upload and repository safety
- Explicit `--allow-upload` approval before sending eligible code changes to Gemini.
- Sensitive-file filtering based on filename heuristics.
- Binary-file exclusion.
- Configurable Git diff and AI input limits.
- No modification of the target repository.
- No execution of target repository scripts.
- Git commands use fixed argument arrays rather than shell command construction.
- Gemini receives no tool or function-calling access.

### Reporting
- Markdown and JSON report formats.
- Findings grouped by severity.
- Repository and commit references.
- Changed-file statistics.
- Model information and review status.
- Rejected-finding counts.
- Explicit disclaimer that AI findings are hypotheses.

## Evaluation

PRReview AI has undergone an initial live evaluation using Google Gemini against a controlled synthetic Git repository.

The evaluation contained five deliberately introduced defects and two clean control files.

### Initial live evaluation results

| Metric | Result |
|---|---:|
| Model | Gemini 2.5 Flash |
| Changed files | 7 |
| Added lines | 43 |
| Planted defects identified | 5 / 5 |
| Clean control files incorrectly flagged | 0 |
| Rejected findings | 0 |

### Issues identified

1. **SQL injection:** Unsafe SQL query construction using interpolated input.
2. **Broken access control:** Missing invoice ownership authorization.
3. **Pagination logic:** Incorrect offset calculation for one-based pagination.
4. **Reservation logic:** Exact-stock reservations incorrectly rejected.
5. **Monetary calculation:** Premature rounding during currency conversion.

Gemini identified all five planted defects and did not report findings in either clean control file.

### Evaluation limitations

This is an initial controlled smoke test, not a representative benchmark of real-world code review accuracy.

The fixture contains deliberately introduced defects with relatively explicit behavioral requirements. Its results should not be interpreted as production precision, recall, or a guarantee of detection performance.

The evaluation does not establish that suggested fixes compile, pass tests, or resolve every underlying issue.

All AI-generated findings require human review.

## Requirements

- Node.js 22 or later.
- Git installed and available on your PATH.
- Google Gemini API key for AI-powered reviews.

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

### 3. Build the project

```bash
npm run build
```

### 4. Run automated tests

```bash
npm test
```

The automated test suite uses mocked AI responses and temporary Git repositories.

A Gemini API key is not required to run the automated tests, and the test suite does not make live API requests.

## Configure Gemini

Create a `.env` file in the PRReview AI project directory, using `.env.example` as a reference.

```env
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
```

Get your API key from [Google AI Studio](https://aistudio.google.com/apikey).

**Security notes:**
- Use your own API key.
- Never commit your `.env` file.
- Never expose API keys in logs, screenshots, or public issues.

The CLI loads configuration from its current working directory, not from the target repository passed through `--repo`.

## Usage

### 1. Review without uploading code

```bash
npm run dev -- review --repo /path/to/repository --base main
```

This produces a local metadata report.

It does not initialize the Gemini client or send repository content to the API.

### 2. Run an AI-powered review

```bash
npm run dev -- review --repo /path/to/repository --base main --head HEAD --allow-upload
```

The `--allow-upload` flag explicitly approves sending eligible diff content to Google Gemini for that invocation.

### 3. Generate JSON output

```bash
npm run dev -- review --repo /path/to/repository --base main --head HEAD --format json --allow-upload
```

### Available CLI options

| Option | Description |
|---|---|
| `--repo` | Target Git repository. Defaults to the current directory. |
| `--base` | Base commit reference. Required. |
| `--head` | Head commit reference. Defaults to `HEAD`. |
| `--format` | Report format: `markdown` or `json`. |
| `--allow-upload` | Explicitly approve sending eligible diff content to Gemini. |

## Finding validation

Gemini is instructed to return structured findings containing:

- File path.
- Line number.
- Severity: critical, high, medium, or low.
- Category: bug, security, performance, error handling, or missing test.
- Title and description.
- Suggested fix.
- Confidence level.

PRReview AI does not automatically trust these references.

Each finding is independently checked to ensure:

1. Its file exists in the eligible changed-file set.
2. Its path is not absolute, unsafe, or a traversal path.
3. Its file is not excluded as sensitive or binary.
4. Its line number falls within an added-line range in the diff.

Invalid findings are rejected and counted in the report.

**Important:** These checks validate the structure and location of a finding. They do not prove that the reported issue is a real bug.

## Safety and privacy

PRReview AI is designed to minimize unnecessary repository exposure.

| Protection | Behavior |
|---|---|
| Upload approval | No Gemini request without `--allow-upload`. |
| Sensitive files | Excluded using filename-based sensitivity rules. |
| Binary files | Binary contents are not sent to Gemini. |
| Unsafe paths | Rejected during validation. |
| Input limits | Oversized diffs and AI inputs fail before the request. |
| Repository modification | The target repository is not modified. |
| Script execution | Target repository scripts are not executed. |
| Git execution | Uses fixed argument arrays rather than shell command construction. |
| Model permissions | Gemini is not given tool or function-calling access. |

With explicit approval, only eligible text patches are sent to Google Gemini.

### Important privacy considerations

- Sensitive-file detection relies on filename-based heuristics. It cannot reliably detect secrets embedded inside ordinary source files.
- Review the commit range and eligible changes before approving an upload.
- Sending code to Gemini is subject to Google's API terms and data-handling policies.
- AI-generated findings can be incorrect, incomplete, or speculative.

## Limits and failure handling

PRReview AI enforces configurable limits on Git diff output and serialized AI input.

| Setting | Default |
|---|---:|
| `MAX_DIFF_BYTES` | 1 MiB |
| `MAX_AI_INPUT_BYTES` | 128 KiB |
| Request timeout | 60 seconds |
| Maximum generated output | 8,192 tokens |

Limits must be positive integers and cannot exceed 100 MB.

Oversized inputs fail before the request is made. The application does not silently truncate the diff or retry indefinitely.

Provider errors, response-parsing failures, blocked output, and invalid structured responses are handled as distinct failure cases where possible.

Diagnostic output is sanitized to avoid exposing credentials and raw request content.

## Reports

Generated reports include:

- Repository and commit references.
- Changed-file statistics.
- AI model used, when applicable.
- Review summary.
- Findings grouped by severity.
- Suggested fixes and confidence levels.
- Rejected-finding count.
- A disclaimer that findings are AI-generated hypotheses.

Reports also explicitly state that tests were not executed by the review.

## Current limitations

PRReview AI currently:

- Reviews committed Git changes only.
- Compares two commit endpoints; it does not implement merge-base pull-request semantics.
- Does not review uncommitted working-tree changes.
- Does not execute tests or independently reproduce reported bugs.
- Does not guarantee detection of all vulnerabilities or defects.
- Does not guarantee that every valid issue will be identified by the model.

An empty findings list does not mean the reviewed code is bug-free.

PRReview AI is an assistive review tool, not a replacement for human code review, automated testing, or security analysis.

## Testing

Run the automated test suite:

```bash
npm test
```

Tests cover:

- Git diff extraction.
- Sensitive and binary file handling.
- Upload approval.
- Mocked Gemini responses.
- Structured-output validation.
- Invalid paths and line references.
- Report generation.

Automated tests do not establish live provider availability or real-world review accuracy. Those require separate live API and controlled evaluation runs.

## Project structure

```text
PRReview-AI/
│
├── src/
│   ├── ai/          # Gemini client and analysis
│   ├── git/         # Git diff extraction
│   ├── review/      # Review orchestration and validation
│   ├── reports/     # Markdown and JSON report generation
│   └── cli/         # Command-line interface
│
├── tests/           # Automated tests
├── examples/        # Example review material
│
├── .env.example
├── .gitignore
├── package.json
├── package-lock.json
├── tsconfig.json
└── README.md
```

## Design principle

> Let the model suggest. Let deterministic code validate. Let humans decide.

PRReview AI uses an LLM to identify potential issues while keeping file eligibility, line-reference checks, upload approval, and report generation under local programmatic control.

---

**Repository:** [github.com/bharathkumar39293/PRReview-AI](https://github.com/bharathkumar39293/PRReview-AI)

**Technology:** TypeScript · Node.js · Google Gemini · Zod · Git
