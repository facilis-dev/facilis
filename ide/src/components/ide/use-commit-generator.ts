// The controller composition of the commit-message generator (D-197).
//
// Source Control keeps the wiring: the same saved model/key the chat uses (loadAiSettings /
// callModel), the IDE locale for the description language, and the git content seam the git
// tools already read (createRepoContents). The generator itself stays port-injected so tests
// never boot a controller.

import { useMemo } from "react";
import { callModel } from "@/ai/client";
import { createCommitGenerator, type CommitGenerator } from "@/ai/commit-generation";
import { createRepoContents } from "@/ai/git-repo";
import { loadAiSettings } from "@/ai/settings";
import { getLocale } from "@/i18n";
import type { IdeController } from "@/vv/controller";

export function useCommitGenerator(controller: IdeController): CommitGenerator["generate"] {
  const generator = useMemo(
    () =>
      createCommitGenerator({
        loadSettings: loadAiSettings,
        call: callModel,
        locale: getLocale,
        contents: createRepoContents({
          bridge: controller.bridge,
          readText: (absolute) => controller.readFileText(absolute),
        }),
      }),
    [controller],
  );
  return generator.generate;
}
