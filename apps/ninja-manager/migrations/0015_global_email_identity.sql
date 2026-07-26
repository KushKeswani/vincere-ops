-- Sign-in accepts an email address without a tenant selector, so that email must
-- identify exactly one user across the whole installation. Creating the index
-- intentionally fails without modifying users if historical cross-tenant or
-- case-only duplicates exist; an operator must reconcile those identities first.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_global_ci_unique
  ON users (lower(email));
