-- Seed migration generated from facilis.config.ts by @facilis.dev/auth seedStatements().
-- role_permissions is a projection of the config and is written ONLY here (SPEC 5.3/8.4.2).
INSERT INTO roles (name) VALUES ('admin') ON CONFLICT DO NOTHING;
INSERT INTO roles (name) VALUES ('manager') ON CONFLICT DO NOTHING;
INSERT INTO roles (name) VALUES ('user') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role, permission) VALUES ('admin', '*') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role, permission) VALUES ('manager', 'todos:read') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role, permission) VALUES ('manager', 'todos:write') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role, permission) VALUES ('manager', 'users:read') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role, permission) VALUES ('manager', 'jobs:read') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role, permission) VALUES ('manager', 'jobs:exec') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role, permission) VALUES ('user', 'todos:read') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role, permission) VALUES ('user', 'todos:write') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role, permission) VALUES ('user', 'jobs:read') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role, permission) VALUES ('user', 'jobs:exec') ON CONFLICT DO NOTHING;
