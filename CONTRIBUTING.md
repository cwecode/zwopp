# Contributing

Thanks for your interest! Screenbook is in an early phase, so issues and ideas are just as
welcome as pull requests.

## Ground rules

- **Original work only.** Contribute only code, assets, icons and texts you wrote yourself
  or have the rights to under a license compatible with MIT/Apache-2.0.
- **Core first.** Logic belongs in `crates/core`; `apps/desktop` only wires it to the UI.
  A feature should be usable from a future CLI/API without the UI.
- **Bigger decisions get an ADR** in `docs/adr/` (copy the latest one as template).

## Workflow

1. Fork, create a branch, make your change.
2. Run the checks:
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
2. Push a tag `v<version>`. For a dry run use a pre-release tag such as `v1.1.0-rc.1`.
3. The [release workflow](.github/workflows/release.yml) checks the versions, builds the
   installers for Windows, macOS (Apple silicon and Intel) and Linux and attaches them, with
   `SHA256SUMS.txt`, to a draft release.
4. Try a download, then publish the draft on GitHub.

## License

By contributing you agree that your contributions are dual-licensed under MIT and
Apache-2.0, like the rest of the project.
