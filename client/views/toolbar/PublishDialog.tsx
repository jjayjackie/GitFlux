// VS Code's "Pick a remote to publish the branch to:", for a repository with several remotes. With one, the branch is
// published there without asking; with none, there is nothing to publish to (views/toolbar/useSync.ts).

import { useState } from "react";
import { View } from "react-native";
import type { RemoteEntry } from "../../../shared/schemas.ts";
import { useT } from "../../i18n/messages.ts";
import * as codicon from "../../ui/codicons.ts";
import { FormDialog } from "../../ui/Dialog.tsx";
import type { DialogProps } from "../../ui/Dialog.tsx";
import { Glyph } from "../../ui/Glyph.tsx";
import { Row } from "../../ui/Row.tsx";
import { T } from "../../ui/Text.tsx";
import { useTheme } from "../../ui/theme.ts";

export interface PublishDialogProps {
  branch: string;
  remotes: readonly RemoteEntry[];
  /** Publishes to the chosen remote; the dialog closes when it resolves and shows a failure in place. */
  onPublish: (remote: string) => Promise<unknown>;
}

export function PublishDialog({ open, onClose, branch, remotes, onPublish }: DialogProps & PublishDialogProps) {
  const th = useTheme();
  const { t } = useT();
  // VS Code puts origin first when there is one.
  const [chosen, choose] = useState(() => (remotes.some((remote) => remote.name === "origin") ? "origin" : (remotes[0]?.name ?? "")));
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={t("toolbar.publishPick", { branch })}
      icon={codicon.cloudUpload}
      submitLabel={t("toolbar.publish")}
      canSubmit={chosen !== ""}
      onSubmit={() => onPublish(chosen)}
      testID="ag-publish-dialog"
    >
      <View accessibilityRole="radiogroup" accessibilityLabel={t("toolbar.publishPick", { branch })} style={{ borderWidth: 1, borderColor: th.c.border, borderRadius: th.radius.sm }}>
        {remotes.map((remote) => (
          <Row
            key={remote.name}
            accessibilityRole="radio"
            accessibilityLabel={remote.name}
            selected={remote.name === chosen}
            onPress={() => choose(remote.name)}
            testID={`ag-publish-remote-${remote.name}`}
          >
            <View style={{ width: th.icon }}>{remote.name === chosen && <Glyph icon={codicon.check} size={th.icon - 2} color={th.c.accent} />}</View>
            <T lines={1} weight="500">
              {remote.name}
            </T>
            <T size={th.small} tone="muted" lines={1} style={{ flex: 1, minWidth: 0 }}>
              {remote.pushUrl || remote.fetchUrl}
            </T>
          </Row>
        ))}
      </View>
    </FormDialog>
  );
}
