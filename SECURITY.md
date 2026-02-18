# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 3.x     | :white_check_mark: |
| < 3.0   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability in Aura Tab, please report it responsibly.

**Do NOT open a public issue.** Instead:

1. Email: [nil-byte@users.noreply.github.com](mailto:nil-byte@users.noreply.github.com)
2. Include a detailed description of the vulnerability
3. Provide steps to reproduce the issue
4. If possible, suggest a fix

### What to expect

- **Acknowledgement**: Within 48 hours
- **Initial assessment**: Within 1 week
- **Fix timeline**: Critical issues within 2 weeks, others within 30 days
- **Credit**: You will be credited in the release notes (unless you prefer anonymity)

## Scope

The following are in scope:

- XSS vulnerabilities in the extension pages
- Data leakage through the extension's storage
- Privilege escalation via Chrome Extension APIs
- Insecure network requests (e.g., mixed content)
- WebDAV credential handling issues

The following are out of scope:

- Issues in third-party libraries (report upstream)
- Browser-level vulnerabilities
- Social engineering attacks
- Denial of service attacks

## Security Best Practices

Aura Tab follows these security practices:

- **Content Security Policy**: Strict CSP via `manifest.json`
- **Input sanitization**: All user input is escaped via `escapeHtml()` before DOM insertion
- **No remote code execution**: `script-src 'self'` prevents inline scripts
- **Minimal permissions**: Only necessary Chrome APIs are requested
- **Local-first data**: All data stored locally; WebDAV sync is opt-in
