// The contract lens's schema-object badges (issue #69): RLS and policy count for tables, access
// mode and permission for views. Split from ProjectGraphContractBadges.tsx (route facts and the
// shared diagnostics badge) so both files stay under the 300-line source limit. Same rules: glyph
// plus label/tooltip, unknown facts as hatched rings, role tokens only (D-043/D-044).

import KeyRound from "~icons/lucide/key-round";
import Shield from "~icons/lucide/shield";
import ShieldCheck from "~icons/lucide/shield-check";
import ShieldOff from "~icons/lucide/shield-off";
import User from "~icons/lucide/user";
import UserCog from "~icons/lucide/user-cog";
import { t } from "@/i18n";
import { FactBadge } from "./ProjectGraphContractBadges";

export function RlsBadge({
  rlsEnabled,
  unknown,
  compact,
}: {
  rlsEnabled: boolean;
  unknown: boolean;
  compact: boolean;
}) {
  if (unknown) {
    return (
      <FactBadge
        testId="contract-rls"
        tone="warn"
        unknown
        glyph={<Shield className="size-2.5" />}
        label={t("projectGraph.contract.rlsUnknown")}
        compact={compact}
      />
    );
  }
  return (
    <FactBadge
      testId="contract-rls"
      tone={rlsEnabled ? "ok" : "muted"}
      glyph={rlsEnabled ? <ShieldCheck className="size-2.5" /> : <ShieldOff className="size-2.5" />}
      label={t(rlsEnabled ? "projectGraph.contract.rls" : "projectGraph.systemOnly")}
      compact={compact}
    />
  );
}

export function PoliciesBadge({
  count,
  unknown,
  compact,
}: {
  count: number;
  unknown: boolean;
  compact: boolean;
}) {
  return (
    <FactBadge
      testId="contract-policies"
      tone="muted"
      unknown={unknown}
      glyph={<Shield className="size-2.5" />}
      label={t(
        unknown ? "projectGraph.contract.policiesUnknown" : "projectGraph.contract.policies",
        { count },
      )}
      count={unknown ? undefined : count}
      compact={compact}
    />
  );
}

export function AccessBadge({
  access,
  compact,
}: {
  access: "invoker" | "definer" | null;
  compact: boolean;
}) {
  if (access === null) {
    return (
      <FactBadge
        testId="contract-access"
        tone="warn"
        unknown
        glyph={<User className="size-2.5" />}
        label={t("projectGraph.contract.accessUnknown")}
        compact={compact}
      />
    );
  }
  return (
    <FactBadge
      testId="contract-access"
      tone={access === "definer" ? "warn" : "muted"}
      glyph={
        access === "definer" ? <UserCog className="size-2.5" /> : <User className="size-2.5" />
      }
      label={t(
        access === "definer" ? "projectGraph.access.definer" : "projectGraph.access.invoker",
      )}
      compact={compact}
    />
  );
}

export function ViewPermissionBadge({
  permission,
  unknown,
  compact,
}: {
  permission: string | null;
  unknown: boolean;
  compact: boolean;
}) {
  if (unknown) {
    return (
      <FactBadge
        testId="contract-permission"
        tone="warn"
        unknown
        glyph={<KeyRound className="size-2.5" />}
        label={t("projectGraph.contract.permissionUnknown")}
        compact={compact}
      />
    );
  }
  return (
    <FactBadge
      testId="contract-permission"
      tone="info"
      glyph={<KeyRound className="size-2.5" />}
      label={permission ?? t("projectGraph.public")}
      title={
        permission === null
          ? t("projectGraph.public")
          : t("projectGraph.permission", { permission })
      }
      compact={compact}
    />
  );
}
