# Tuloshuuto – Implementation Specification

## 1. Purpose

Build a small TypeScript application that converts football and futsal match calendars from the Finnish Football Association's (Palloliitto) Tulospalvelu into iCalendar (ICS) files suitable for importing into Nimenhuuto.com.

The application is called **Tuloshuuto**.

Tulospalvelu already provides valid ICS feeds that Nimenhuuto can import. However, two modifications are needed:

1. Simplify event titles and add a team identifier.
2. Add the match location to the beginning of the event description.

The generated ICS files will be published as static files using GitHub Pages.

**This is a one-way, on-demand conversion tool, not a synchronization service.**

Nimenhuuto imports events once. It does not continuously synchronize them with the source calendar.

## 2. Technology

- Node.js
- TypeScript
- pnpm
- GitHub Pages for publishing generated ICS files
- GitHub Actions for manual generation and explicit GitHub Pages deployment

Pin a supported Node.js LTS major version and an exact pnpm version. Declare pnpm in the `packageManager` field. Provide `pnpm typecheck` in addition to `pnpm test`. CI must use `pnpm install --frozen-lockfile`.

Use a suitable iCalendar parsing library if necessary.

Keep the implementation simple. Avoid unnecessary dependencies and abstractions.

No database, web server, API, frontend, or background service is needed.

## 3. Configuration

Each team has a Tulospalvelu ICS calendar URL.

Example:

`https://spl.torneopal.fi/calendar/team/35151943?t=1793022772050`

Support multiple teams using a configuration file.

Example `teams.json`:

```json
{
  "pagesBaseUrl": "https://<username>.github.io/tuloshuuto",
  "teams": [
    {
      "id": "m50",
      "prefix": "M50",
      "url": "https://spl.torneopal.fi/calendar/team/35151943?t=1793022772050"
    }
  ]
}
```

The configuration should be easy to extend with other teams, such as `M45` and `7IDV`.

Do not hardcode team-specific information in the transformation logic.

Use lowercase team IDs for output filenames. Team IDs must match `[a-z0-9_-]+` and must be unique. Reject invalid or duplicate IDs before downloading or writing any files; never silently normalize them.

Require a nonempty team prefix, an HTTPS source URL, and a valid HTTPS `pagesBaseUrl` without a query or fragment. Join public URLs correctly whether the base URL has a trailing slash or not. An empty team list is a configuration error. Validate the complete configuration before processing teams.

## 4. Source ICS format

Example event from Tulospalvelu:

```ics
BEGIN:VEVENT
DTSTAMP:20261205T162000Z
UID:4402981@spl.torneopal.fi
CATEGORIES:Miehet 50 Futsal-Ykkönen
SUMMARY:KaVo – Soho Seniors, Miehet 50 Futsal-Ykkönen
URL:https://tulospalvelu.palloliitto.fi/match/4402981
STATUS:CONFIRMED
LOCATION:Harjuniitty, Lautamiehenkatu 1, Nokia
DESCRIPTION:https://tulospalvelu.palloliitto.fi/match/4402981
DTSTART:20261205T162000Z
DTEND:20261205T171000Z
TRANSP:OPAQUE
END:VEVENT
```

The source calendar contains multiple `VEVENT` components.

The calendar also contains metadata such as `PRODID`, `VERSION`, `CALSCALE`, `METHOD`, `NAME`, `X-WR-CALNAME`, and `X-WR-TIMEZONE`.

Preserve these fields.

## 5. Transformations

### 5.1 Event title (`SUMMARY`)

The original event title contains the competing teams followed by the competition name.

Example:

```text
KaVo – Soho Seniors, Miehet 50 Futsal-Ykkönen
```

The competition name is available in the event's `CATEGORIES` property.

Remove the suffix consisting of a comma, a space, and the category value.

Then prepend the configured team identifier followed by a colon and a space.

Example:

```text
M50: KaVo – Soho Seniors
```

Another example:

```text
Original:
Soho Seniors – HFN-50, Miehet 50 Futsal-Ykkönen

Converted:
M50: Soho Seniors – HFN-50
```

Rules:

- Use the event's `CATEGORIES` value to identify the competition suffix.
- Remove the suffix only when it matches.
- Do not remove arbitrary common substrings.
- If the expected suffix is missing, preserve the original title and still add the team prefix.
- Preserve team names and their original spelling.
- Do not duplicate the prefix if the transformation is applied more than once. Treat only an exact leading `<configured prefix>: ` as an existing prefix.
- If `CATEGORIES` is missing or empty, preserve the title and add the prefix.
- For multiple category values or repeated `CATEGORIES` properties, decode their individual text values and remove the longest matching `, <category>` suffix, at most once. Do not join categories or use substring matching.

### 5.2 Event description (`DESCRIPTION`)

Nimenhuuto imports the `DESCRIPTION` property into its event details field.

However, Nimenhuuto does not populate its separate location field from the ICS `LOCATION` property.

This behavior has been verified experimentally.

Therefore, prepend the event location to the description.

Original:

```text
https://tulospalvelu.palloliitto.fi/match/4402981
```

Converted:

```text
Harjuniitty, Lautamiehenkatu 1, Nokia
https://tulospalvelu.palloliitto.fi/match/4402981
```

The location and original description must be separated by exactly one newline.

In serialized ICS format, the newline must be encoded according to the iCalendar specification:

```ics
DESCRIPTION:Harjuniitty\, Lautamiehenkatu 1\, Nokia\nhttps://tulospalvelu.palloliitto.fi/match/4402981
```

This format has been tested successfully with Nimenhuuto.

Rules:

- Use the original `LOCATION` property.
- Preserve the complete original description.
- Do not add the location if it is missing or empty.
- Avoid duplicating the location if the transformation is applied repeatedly.
- Handle escaping of commas, backslashes, and newlines correctly.
- If `DESCRIPTION` is missing or empty and the location is present, use the location alone, with no trailing newline.
- If both fields are missing or empty, preserve the original description state.
- Consider the location already prepended only when the decoded description equals the decoded location or starts with the complete location followed by a newline. A match elsewhere in the description does not count.
- Otherwise concatenate the decoded location, one newline, and the complete decoded original description. Preserve any leading newlines already present in the original description.
- Treat a whitespace-only location as empty; otherwise preserve the original location text. Normalize decoded CRLF/CR line endings to LF for text comparison and serialization.

### 5.3 Other properties

Preserve all other event properties.

In particular:

- `UID`
- `DTSTART`
- `DTEND`
- `DTSTAMP`
- `CATEGORIES`
- `URL`
- `STATUS`
- `LOCATION`
- `TRANSP`

Do not modify event dates, times, or time zones.

Preserve calendar-level metadata as well.

The generated file must be a valid UTF-8 iCalendar document.

Follow RFC 5545 requirements, including CRLF content-line endings, escaping, and line folding at 75 octets without splitting UTF-8 characters.

Preservation means semantic equivalence, not byte-for-byte equality. Property ordering, folding, and equivalent escaping may change. Preserve property parameters (including `TZID` and `VALUE`), unknown and `X-` properties, repeated properties, and nested components such as `VALARM` and `VTIMEZONE`. Select a parser/serializer that can preserve this information; do not reconstruct events using a limited list of known fields.

### 5.4 Validation boundary

Reject responses that cannot be parsed as a complete `VCALENDAR`, contain trailing non-calendar content, lack required calendar metadata, or contain zero events. Do not accept arbitrary text or HTML as an empty calendar.

Every event must have a nonempty `UID`, `DTSTAMP`, `DTSTART`, and `SUMMARY`. For this match-calendar tool, require `DTSTART` even for cancelled events. Reject duplicate occurrences of these single-valued properties, including multiple `DESCRIPTION` or `LOCATION` properties. Missing optional properties such as `DTEND`, `DESCRIPTION`, `LOCATION`, or `CATEGORIES` are allowed; do not invent dates, durations, or locations. Validate the syntax and value types of the properties used by the transformation, while preserving unknown properties without attempting exhaustive RFC validation.

A malformed event fails the entire team's calendar. Never silently drop an event and replace the previous file with a partial calendar. Parse and validate the serialized output again and verify its event count and the semantic preservation of all properties except the intended `SUMMARY` and `DESCRIPTION` changes.

## 6. Output and data protection

Generate one ICS file per configured team.

Example:

```text
docs/
  m50.ics
  m45.ics
  7idv.ics
```

The files will be served directly through GitHub Pages.

Example published URL:

`https://<username>.github.io/tuloshuuto/m50.ics`

The application should generate all configured calendars with one command:

```bash
pnpm generate
```

Optionally support generating a single team:

```bash
pnpm generate --team m50
```

### 6.1 Protect existing calendar files

**Never overwrite a previously generated calendar unless the new calendar has been successfully fetched, parsed, validated, and transformed.**

The following conditions must NOT overwrite an existing file:

- Network failure.
- HTTP error (non-2xx response).
- Empty HTTP response.
- Invalid ICS content.
- Valid ICS calendar containing zero `VEVENT` components.
- Parsing or transformation error.
- Invalid generated ICS content.

Tulospalvelu calendar URLs may expire or become invalid. In some cases, an expired URL might return a technically valid but empty calendar.

**Treat zero-event calendars as failures, not successful empty results.**

Write generated files atomically using a uniquely named temporary file in the same directory as the destination and rename it only after successful generation. Clean up temporary files on failure without touching the previous destination. If the validated output bytes equal the existing file, leave that file untouched and report successful generation with `changed: false`.

Do not delete previously generated calendar files automatically.

Process teams independently:

- A failure for one team must not prevent successful generation of other teams.
- Preserve the previous file for failed teams.
- Report all failures clearly.
- Exit with a nonzero status if any requested team fails.

### 6.2 Output URLs

At the end of every generation run, print the complete public GitHub Pages URLs of all successfully generated calendar files.

Example:

```text
Calendar generation completed.

M50:  https://<username>.github.io/tuloshuuto/m50.ics
M45:  https://<username>.github.io/tuloshuuto/m45.ics
7IDV: https://<username>.github.io/tuloshuuto/7idv.ics
```

Print one URL per line so it can easily be copied into Nimenhuuto's calendar import.

If a team fails, distinguish it clearly from successfully generated calendars.

Do not report an old calendar URL as successfully generated.

Print the summary even when some teams fail.

## 7. Architecture

Keep the conversion logic separate from downloading and file writing.

Suggested structure:

```text
tuloshuuto/
├── .github/
│   └── workflows/
│       └── generate.yml
├── src/
│   ├── index.ts
│   ├── config.ts
│   └── transform.ts
├── test/
│   ├── fixtures/
│   │   └── source.ics
│   └── transform.test.ts
├── docs/
│   └── index.html
├── teams.json
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
└── README.md
```

This is a suggestion, not a strict requirement.

The transformation should be independently testable without network access.

Prefer a function with an interface similar to:

```typescript
function transformCalendar(
  icsContent: string,
  teamPrefix: string
): string
```

The function must not fetch URLs or write files.

## 8. Testing

Implement automated unit tests.

At minimum, cover:

1. Removing the competition suffix from `SUMMARY`.
2. Adding the configured team prefix.
3. Preserving titles when the competition suffix does not match.
4. Prepending the location to `DESCRIPTION`.
5. Preserving the original description.
6. Handling missing `LOCATION`.
7. Correct escaping of commas and newlines.
8. Preserving event dates and times.
9. Processing multiple events.
10. Avoiding duplicate prefixes and descriptions on repeated transformations.
11. Preserving calendar-level metadata.
12. Handling folded ICS lines.
13. Rejecting empty HTTP responses.
14. Rejecting invalid ICS documents.
15. Rejecting calendars containing zero events.
16. Preserving existing output files after failed generation.
17. Continuing with other teams when one team fails.
18. Producing correct public URLs, with and without a trailing slash in the base URL.
19. Missing and empty descriptions, exact location-prefix detection, and preservation of existing description newlines.
20. Multiple categories and missing categories.
21. Preservation of unknown properties, parameters, `VTIMEZONE`, and nested `VALARM` components.
22. UTF-8 octet-aware line folding and CRLF serialization.
23. Invalid or duplicate team IDs and malformed configuration before any output write.
24. Missing required event properties and whole-team failure when one event is malformed.
25. HTTP failures and timeout while consuming the response body, using local mocks.
26. A fresh machine-readable report and a nonzero exit status after partial failure, while successful output files remain available.
27. Temporary-file cleanup on write/rename failure and unchanged output bytes causing no destination rewrite.

In addition to automated tests, verify the manual workflow's partial-failure behavior: successful changed files are committed and deployed, failed teams retain their previous files, the summary is present, and the final run status is failed. Use an intentionally failing public test source without exposing real source URLs. Restore the normal configuration afterward.

Use a local ICS fixture based on the example data above.

Tests must not depend on Tulospalvelu being available.

## 9. GitHub Pages

The generated ICS files should be placed in `docs/`.

Configure GitHub Pages to use **GitHub Actions** as its publishing source. Use `docs/` as the local output directory and upload it with the official Pages artifact action, then deploy it with the official Pages deployment action.

Do not rely on a commit made with the workflow's `GITHUB_TOKEN` to trigger branch-based Pages publishing. Deployment must be an explicit part of the manually triggered workflow.

No special HTML interface is required.

An optional minimal `index.html` can list the available team calendars.

Do not add a frontend framework.

Calendars published through GitHub Pages are public. Only configure sources whose event information may be published publicly. Never copy source URLs into published metadata or diagnostic output as part of reporting. Preserve source event properties as specified, so users must also review those properties for information unsuitable for public publication.

## 10. GitHub Actions

Provide a GitHub Actions workflow triggered manually using `workflow_dispatch`.

Do not configure scheduled execution.

The workflow should:

1. Check out the `main` branch and verify that the workflow was dispatched from `main`; fail early for other refs.
2. Install the pinned Node.js and pnpm versions.
3. Install dependencies using the lockfile.
4. Run type checking and tests. Failures here prevent generation, commit, and deployment.
5. Generate all configured calendars and capture the command's real exit status plus a machine-readable report.
6. Even when generation partially fails, commit and push only successfully generated ICS files whose contents changed.
7. After a successful push (or when no commit is needed), upload and deploy the complete `docs/` directory, including preserved files for failed teams. Deploy only if at least one team generated successfully. If every team fails, skip commit and deployment.
8. Write the Job Summary even when generation, commit, or deployment fails.
9. Mark the overall workflow as failed if any team failed or any required commit/deployment operation failed. Delay this final failure until the independent successful results and summary have been handled.

Do not use `continue-on-error` in a way that loses the actual failure status. Do not deploy after a failed push, since the public files would then diverge from the repository's saved outputs.

Use a shared workflow concurrency group with `cancel-in-progress: false` to prevent overlapping generation/commit/deployment execution. GitHub may replace pending runs; this does not promise execution of every queued dispatch. Do not use force pushes or automatically overwrite unrelated remote changes. A push conflict is a publication failure and must be reported.

### 10.1 GitHub Actions Job Summary

**The Job Summary is the primary interface for retrieving generated calendar URLs.**

After each run, produce a clear Markdown summary containing:

- Generation status for each configured team.
- Number of events in each successfully generated calendar.
- Complete public GitHub Pages URL for each successfully generated calendar.
- Error message for each failed team.
- Separate generation, repository update, and Pages deployment outcomes. A generation success does not establish that the public URL serves the new content. If publication fails, label the URLs as target URLs that may still serve old content.

Example:

```markdown
# Tuloshuuto – Calendar Generation

| Team | Status | Events | Calendar |
|------|--------|--------|----------|
| M50 | Success | 12 | https://<username>.github.io/tuloshuuto/m50.ics |
| M45 | Success | 18 | https://<username>.github.io/tuloshuuto/m45.ics |
| 7IDV | Failed | – | – |

### Errors

**7IDV:** Source calendar contains zero events.
Previous calendar file was preserved.
```

Make the URLs clickable in the Markdown summary.

Additionally, provide a separate section with plain URLs, one per line, for easy copying into Nimenhuuto.

The summary must be generated even if some teams fail.

Use GitHub Actions' `$GITHUB_STEP_SUMMARY` mechanism.

Ensure that a failed generation step does not prevent the summary from being displayed.

### 10.2 Git commits

Commit generated ICS files only when their contents have changed.

Do not create empty commits.

If some teams fail but others succeed, commit only the successfully updated files.

Preserve existing files belonging to failed teams.

Document job-scoped GitHub Actions permissions: `contents: write` for the commit job, and `pages: write` plus `id-token: write` for the Pages deployment job. Use the `github-pages` deployment environment. Other jobs should have only the permissions they need. Document that repository rules may block workflow pushes and that Pages must be enabled in repository settings. A personal access token is not required by the default design.

### 10.3 Published URL availability

GitHub Pages deployment may take some time after a commit.

The Job Summary may display the URLs immediately, but the updated content might not yet be publicly available.

Document this behavior.

## 11. Error handling

Handle at least:

- Network failures and timeouts. Apply a 30-second total timeout per team covering both response headers and body consumption. No automatic retry is required for the first version.
- HTTP responses other than 2xx.
- Empty responses.
- Invalid ICS content.
- Calendars containing zero events.
- Missing or malformed configuration.
- Missing event properties.
- File-writing errors.

Report failures clearly, including the affected team.

Never replace a valid previously generated calendar with invalid or empty content.

A calendar containing zero events is always considered a generation failure.

The generation process must produce a machine-readable result or another reliable mechanism that the GitHub Actions workflow can use to build its Job Summary.

Do not parse human-readable console output to determine success or failure.

Write a fresh JSON report for the current run outside `docs/`, for example through `--report <path>`. Include an overall status and, for each requested team, its ID, prefix, generation status, event count, changed flag, target public URL, and sanitized error message where applicable. For failed teams, event count and changed status must not imply successful generation. Attempt to write a report even for configuration errors, with an overall error and no invented team results. Report-writing failure is itself a command failure.

The workflow must never consume a stale report from a previous run. Missing or malformed reports are workflow failures. Publication results belong in the workflow summary separately from this generation report.

Do not log complete source URLs, their query parameters, response bodies, or credentials. Identify failures by team ID, operation, and sanitized reason (for example HTTP status or timeout). A source URL query parameter may grant access even when its purpose is undocumented.

## 12. README

Write a concise README explaining:

- What Tuloshuuto does.
- How to install dependencies.
- How to configure teams.
- How to generate calendars locally.
- How to run tests.
- How to enable GitHub Pages with GitHub Actions as the publishing source and configure the required workflow permissions.
- How to run the manual GitHub Actions workflow.
- How to find generated calendar URLs in the Job Summary.
- How to import a generated calendar into Nimenhuuto.

Explain that Nimenhuuto imports the calendar once and does not synchronize future changes automatically.

Explain that the location is intentionally placed at the beginning of the event description because Nimenhuuto ignores the standard ICS `LOCATION` property during import.

Users can optionally move the location from the description to Nimenhuuto's separate location field while reviewing imported events.

Explain that failed calendar generation preserves the previous successfully generated file. Also explain public visibility, source URL handling, and how generation success differs from publication success.

## 13. Scope limitations

Do not implement:

- Automatic synchronization with Nimenhuuto.
- Nimenhuuto API integration.
- A database.
- A persistent HTTP server.
- A web-based configuration interface.
- Scheduled calendar updates.
- Automatic event deduplication in Nimenhuuto.
- Changes to event dates or durations.

The objective is a small, maintainable tool for producing import-ready ICS files.

## 14. Acceptance criteria

The implementation is complete when:

1. `pnpm install` succeeds.
2. `pnpm test` passes.
3. `pnpm generate` downloads the configured Tulospalvelu calendars.
4. One valid ICS file is generated per successfully processed team.
5. Event titles have the correct team prefix and no redundant competition suffix.
6. Event descriptions begin with the location followed by the original description on the next line.
7. All other event properties remain unchanged in meaning.
8. Invalid or empty source calendars never overwrite existing generated files.
9. A failed team does not prevent other teams from being processed.
10. Generated calendars can be fetched as static files from GitHub Pages.
11. Nimenhuuto can import the generated files successfully.
12. The command prints all successfully generated calendar URLs.
13. The GitHub Actions workflow can be triggered manually.
14. The workflow commits only changed, successfully generated files.
15. The GitHub Actions Job Summary displays team statuses, event counts, errors, and clickable calendar URLs.
16. The Job Summary is available even when generation partially fails.
17. `pnpm typecheck` passes.
18. The manual workflow explicitly deploys the Pages artifact, without depending on a token-created commit to trigger publishing.
19. Partial failure still permits successful updates to be committed and deployed before the workflow reports failure.
20. A manual end-to-end check fetches a published calendar and verifies titles, descriptions, dates, and times in Nimenhuuto's import preview. Record this separately from automated validation; do not claim it passed without performing it. The user may perform this check in their authenticated Nimenhuuto session without sharing credentials.

Use the simplest reasonable implementation and avoid overengineering.