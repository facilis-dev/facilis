-- Seed migration generated from facilis.config.ts by @facilis.dev/auth seedStatements().
-- role_permissions is a projection of the config and is written ONLY here (SPEC 5.3/8.4.2).
INSERT INTO roles (name) VALUES ('admin') ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO roles (name) VALUES ('user') ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO role_permissions (role, permission) VALUES ('admin', '*') ON CONFLICT DO NOTHING;
