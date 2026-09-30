-- Login is password-only: no username field, the server matches the typed
-- password to a user row. That only works if passwords are distinct — a shared
-- password would be ambiguous (login takes the first match). This makes the DB
-- reject a duplicate at insert time rather than leaving it to remember.
create unique index if not exists users_password_unique on users (password);
