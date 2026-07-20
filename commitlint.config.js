// Conventional Commits, enforced on commit-msg via husky (.husky/commit-msg).
// semantic-release reads these commits on `main` to compute the next version:
//   fix: → patch, feat: → minor, `BREAKING CHANGE:` footer → major.
export default {
	extends: ['@commitlint/config-conventional']
}
