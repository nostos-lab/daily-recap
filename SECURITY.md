# Security Policy

## Supported versions

We support the latest published minor version on the VS Code Marketplace and Open VSX. Older versions are best-effort.

| Version       | Supported |
| ------------- | --------- |
| Latest minor  | ✅        |
| Older minors  | ❌        |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security reports.** Public disclosure before a fix is available puts users at risk.

Use one of the private channels below.

### Preferred: GitHub Private Vulnerability Reporting

Open a private advisory at:

- https://github.com/nostos-lab/daily-recap/security/advisories/new

This keeps the report scoped to the maintainers and lets us collaborate on a patch and disclosure timeline within GitHub.

### Email fallback

If you cannot use GitHub advisories, email:

- **admin@nostoslab.space**

Please include:
- A description of the issue and the potential impact
- Steps to reproduce, or a minimal proof of concept
- Affected versions, platforms (VS Code Marketplace / Open VSX), and configuration
- Any suggested mitigations you have in mind
- How you would like to be credited (or whether you prefer to remain anonymous)

## Response targets

These are best-effort targets, not guarantees:

| Step                                | Target           |
| ----------------------------------- | ---------------- |
| Initial acknowledgement             | Within 7 days    |
| Triage / severity assessment        | Within 14 days   |
| Fix released (where applicable)     | Coordinated with reporter, typically aligned with the next minor or patch release |

## Scope

In scope:

- The extension itself (commands, configuration, renderer, sinks)
- Build / packaging pipeline that ships the extension
- Documentation that could mislead users into insecure usage

Out of scope:

- Vulnerabilities in upstream dependencies that are already publicly tracked (please report to the upstream project)
- Issues that require physical access to the user's machine or a compromised host
- Bugs that are not security-relevant — please use a normal issue for those

## Disclosure

We follow coordinated disclosure: once a fix is available and shipped, we will publish an advisory crediting the reporter (unless they prefer to remain anonymous). Thank you for helping keep DailyRecap users safe.
