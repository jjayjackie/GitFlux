// The menu of a file in a commit's (or a comparison's) file list: its history, its blame at that revision, opening it
// in Paseo's file tab where that can be done (ui/FileOpener.tsx), and copying its path.
//
// Usage: <FileTree … fileMenu={useFileMenu(cwd, hash)} />

import { useCallback } from "react";
import type { FileChange } from "../../../../shared/schemas.ts";
import { useT } from "../../../i18n/messages.ts";
import { useDetail } from "../../../state/selection.ts";
import * as codicon from "../../../ui/codicons.ts";
import type { MenuItem } from "../../../ui/floating/context.ts";
import { useOpenFile } from "../../../ui/FileOpener.tsx";
import { useCopy } from "../../graph/commitActions.ts";

/** `rev`: the revision the file is blamed at (a commit, the newer side of a comparison); omitted: the work tree. */
export function useFileMenu(cwd: string, rev?: string): (file: FileChange) => MenuItem[] {
  const { t } = useT();
  const [, setDetail] = useDetail();
  const openFile = useOpenFile();
  const copy = useCopy();
  return useCallback(
    (file: FileChange): MenuItem[] => {
      const items: MenuItem[] = [
        { id: "history", label: t("detail.commitPane.fileHistory"), icon: codicon.history, onPress: () => setDetail({ kind: "fileHistory", path: file.path }) },
        {
          id: "blame",
          label: rev === undefined ? t("detail.commitPane.blame") : t("detail.commitPane.blameAt"),
          disabled: file.status === "D",
          reason: file.status === "D" ? t("detail.commitPane.deleted") : null,
          onPress: () => setDetail(rev === undefined ? { kind: "blame", path: file.path } : { kind: "blame", path: file.path, rev }),
        },
      ];
      if (openFile) items.push({ id: "open", label: t("detail.commitPane.openFile"), icon: codicon.goToFile, onPress: () => openFile(`${cwd}/${file.path}`) });
      items.push({ id: "copy-path", label: t("detail.commitPane.copyPath"), icon: codicon.copy, onPress: () => copy(file.path, t("detail.commitPane.pathCopied")) });
      return items;
    },
    [t, setDetail, openFile, copy, cwd, rev],
  );
}
