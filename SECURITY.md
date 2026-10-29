# Security

## Supported versions

Only the latest release gets security fixes.

## Reporting a vulnerability

Please do **not** open a public issue. Report it privately through GitHub instead:
[Security → Report a vulnerability](https://github.com/cwecode/zwopp/security/advisories/new).

Describe what an attacker can do, how to reproduce it, and on which OS and version. You get
an answer within a week. Once a fix is released, the advisory is published and you are
credited, unless you prefer not to be.

## Scope

Zwopp works offline: it sends no data anywhere and stores screenshots only in the local
library folder. Relevant reports are, for example, files outside the library becoming
readable through the app, crafted library or settings files that run code, or a
download whose content does not match `SHA256SUMS.txt`.

The downloads are not code-signed yet (see the README), so the warning Windows and macOS
show on first start is expected and not a vulnerability.
