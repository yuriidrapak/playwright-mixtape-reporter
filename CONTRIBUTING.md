# Contributing

Bug reports, documentation fixes, terminal compatibility reports, and pull
requests are welcome. Contributions use the project's [MIT license](LICENSE).

1. Fork and clone the repository. Use `.nvmrc` (Node 24.22.1) and npm 11.19+.
2. Run `npm run security`, `npm ci --ignore-scripts`, and `npm run check`.
3. Make a focused change. Add regression coverage for behavioral fixes and
   update [usage](docs/usage.md) for public options or output changes.
4. Run `npm run format`, `npm run check`, and applicable browser/terminal checks
   described in [development](docs/development.md).
5. Open a pull request explaining the problem, resulting behavior, and validation.

For bugs, include reporter, Node, Playwright, OS and terminal versions plus a
minimal reproduction. For visual issues, include terminal size and color-related
environment settings. Remove private URLs, tokens, and customer data.

Treat other contributors with respect. Critique ideas and code, avoid personal
attacks, and keep discussion relevant and inclusive. Maintainers may moderate
abusive or disruptive participation.

Report vulnerabilities through the [security policy](SECURITY.md), not public
bug details. Discuss larger API changes before investing in an implementation.

Read [AGENTS.md](AGENTS.md) for repository invariants and
[supply-chain security](docs/supply-chain-security.md) before changing dependency,
build, or release behavior. Use disposable development environments without
publishing credentials when evaluating unfamiliar contributions or dependencies.
