# Contributing

Thanks for your interest! Zwopp is in an early phase, so issues and ideas are just as
welcome as pull requests. Please follow the [Code of Conduct](CODE_OF_CONDUCT.md), and report
security problems privately as described in [SECURITY.md](SECURITY.md).

## Ground rules

- **Original work only.** Contribute only code, assets, icons and texts you wrote yourself
  or have the rights to under a license compatible with MIT/Apache-2.0.
- **Core first.** Logic belongs in `crates/core`; `apps/desktop` only wires it to the UI.
  A feature should be usable from a future CLI/API without the UI.
- **Bigger decisions get an ADR** in `docs/adr/` (copy the latest one as template).

## Workflow

1. Fork, create a branch, make your change.
2. Run the checks (more in [docs/development.md](docs/development.md)):
   ```bash
   cargo fmt --all
   cargo clippy --workspace --all-targets -- -D warnings
   cargo test --workspace
   npm run typecheck
   ```
3. Use [Conventional Commits](https://www.conventionalcommits.org) for commit messages,
   e.g. `feat(editor): add arrow tool` or `fix(capture): handle mixed DPI`.
4. Open a pull request and describe what you tested and on which OS.

## Releasing (maintainers)

1. Set the version in `Cargo.toml`, `apps/desktop/package.json` and
   `apps/desktop/src-tauri/tauri.conf.json`, and add a `## <version>` section to
   `CHANGELOG.md`.
   A picture on a line of its own in that section shows on the release page.
2. Push a tag `v<version>`. For a dry run use a pre-release tag such as `v1.1.0-rc.1`.
3. The [release workflow](.github/workflows/release.yml) checks the versions, builds the
   installers for Windows, macOS (Apple silicon and Intel) and Linux, attaches them with
   `SHA256SUMS.txt`, adds merged pull requests and the compare link to the notes, and
   publishes the release once everything is there. A failed build leaves an unpublished
   draft; a pre-release tag always stays a draft.

## License

By contributing you agree that your contributions are dual-licensed under MIT and
Apache-2.0, like the rest of the project.
