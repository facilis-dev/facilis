// The project's schema entry point (SPEC Appendix D step 2). A generated project owns the
// DDL for the framework tables it uses, so the auth tables are re-exported here and the
// declaration is what the dev boot materializes and a release renders (D-193). The template
// ships only the login surface: add tables below as the app grows.
export { rolePermissions, roles, sessions, userRoles, users } from "@facilis.dev/auth";
