# Pending CI workflow

This file belongs at `.github/workflows/ci.yml`. It is parked here because the
token used for the first push lacked the GitHub `workflow` scope.

To enable it:

```bash
gh auth refresh -s workflow
mkdir -p .github/workflows && git mv .github/ci-workflow.yml .github/workflows/ci.yml
git commit -m "ci: enable workflow" && git push
```
