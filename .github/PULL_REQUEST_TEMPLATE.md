<!--
Before submitting, read docs/CONTRIBUTING.md — especially the Pull Request section.

PR title MUST follow Conventional Commits format.

  Good titles:
    fix(popup): resolve theme not applying on first load
    feat: add file size display in download notification
    docs: update i18n translation guide
    refactor: extract filter stage into standalone function

  Bad titles:
    fix bugs
    update code
    fix #123
    WIP
-->

## Description

<!-- What does this change do and why? Link related issues: Fixes #123 -->

## Type of change

<!-- Check the one that applies. -->

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (**must** be discussed and approved in an issue first)
- [ ] Refactor (no functional change)
- [ ] Documentation / i18n
- [ ] CI / build configuration

## How has this been tested?

<!-- Describe how you verified your changes. "It compiles" is not sufficient. -->

## AI usage disclosure

<!-- Check the one that applies. Honest disclosure is expected — misleading answers will result in PR closure. -->

- [ ] No AI tools were used
- [ ] AI tools assisted with drafting, refactoring, or boilerplate (I reviewed and understand every line)
- [ ] Substantial portions were AI-generated (I reviewed, tested, and can explain every change)

If AI was used, specify the tool: <!-- e.g., GitHub Copilot, Claude, ChatGPT -->

## Checklist

### Required — PR will not be reviewed without these

- [ ] I have read [CONTRIBUTING.md](../docs/CONTRIBUTING.md)
- [ ] PR changes **fewer than 300 lines** of code (excluding tests and generated files)
- [ ] PR touches **fewer than 10 files**
- [ ] PR addresses **one concern only** — no mixed features, config tweaks, or unrelated fixes
- [ ] I ran checks relevant to this change and listed the results above; required CI passes
- [ ] Commits follow [Conventional Commits](https://www.conventionalcommits.org/) format

### If applicable

- [ ] New feature was discussed and approved in an issue before implementation
- [ ] Tests cover risky behavior or a confirmed regression; omitted tests are explained
- [ ] i18n keys updated in all supported locales and validated with `pnpm lint:i18n`
- [ ] Manifest permissions changes are documented in the PR description with justification

## Release notes

<!-- One-line description for end users, or "none" if not user-facing. -->

Notes:
