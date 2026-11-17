// The detail column (architecture §9): what the selection names — a file's diff, a commit, a file's history, blame, a
// comparison, a stash, a conflict. This file is the router: it draws the column's header (what is shown, and outside
// the narrow layout a close button; the narrow layout's shell draws its own back control) and the pane for the kind of
// detail, each of which fills the rest and draws its own toolbar under the header (client-seams.md). layout/Panel.tsx
// renders `DetailView` keyed by `cwd`.
//
// The header's words for what a file's diff compares are upstream's (paseo-source-control: client/Diff.tsx `compared`), which took
// them from the title VS Code gives a diff editor.

import { View } from "react-native";
import type { DiffSource, FileChange } from "../../../shared/schemas.ts";
import { useT } from "../../i18n/messages.ts";
import { useLayoutMode } from "../../layout/pane.ts";
import { NO_DETAIL, useDetail } from "../../state/selection.ts";
import type { DetailTarget } from "../../state/selection.ts";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { T } from "../../ui/Text.tsx";
import { useTheme } from "../../ui/theme.ts";
import { BlameView } from "./blame/BlameView.tsx";
import { CommitDetailView } from "./commit/CommitDetailView.tsx";
import { CompareView } from "./compare/CompareView.tsx";
import { ConflictView } from "./conflict/ConflictView.tsx";
import { FileDiffView, splitPath } from "./diff/FileDiffView.tsx";
import { FileHistoryView } from "./history/FileHistoryView.tsx";
import { StashDetailView } from "./stash/StashDetailView.tsx";

export interface DetailViewProps {
  /** The selected repository's root. */
  cwd: string;
}

/** A full hash as git abbreviates it by default; anything else (a ref name, a short hash) as it is. */
export const shortRev = (rev: string) => (/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(rev) ? rev.slice(0, 7) : rev);

export function DetailView({ cwd }: DetailViewProps) {
  const th = useTheme();
  const { t } = useT();
  const mode = useLayoutMode();
  const [detail, setDetail] = useDetail();
  if (detail.kind === "none") return <EmptyState icon="FileDiff" title={t("shell.nothingSelected")} testID="ag-detail-empty" />;
  return (
    <View testID="ag-detail" style={{ flex: 1, minHeight: 0 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: th.space.sm,
          minHeight: th.row + 6,
          paddingHorizontal: th.space.md,
          borderBottomWidth: 1,
          borderColor: th.c.border,
        }}
      >
        <View style={{ flex: 1, minWidth: 0 }} testID="ag-detail-title">
          <Title detail={detail} />
        </View>
        {mode !== "narrow" && <IconButton icon="X" label={t("shell.closeDetail")} onPress={() => setDetail(NO_DETAIL)} testID="ag-detail-close" />}
      </View>
      <View key={JSON.stringify(detail)} style={{ flex: 1, minHeight: 0 }}>
        <Pane cwd={cwd} detail={detail} />
      </View>
    </View>
  );
}

/** The pane for a kind of detail. */
function Pane({ cwd, detail }: { cwd: string; detail: Exclude<DetailTarget, { kind: "none" }> }) {
  switch (detail.kind) {
    case "file":
      return <FileDiffView cwd={cwd} source={detail.source} file={detail.file} />;
    case "conflict":
      return <ConflictView cwd={cwd} path={detail.path} />;
    case "commit":
      return <CommitDetailView cwd={cwd} hash={detail.hash} />;
    case "fileHistory":
      return <FileHistoryView cwd={cwd} path={detail.path} />;
    case "blame":
      return <BlameView cwd={cwd} path={detail.path} rev={detail.rev} />;
    case "compare":
      return <CompareView cwd={cwd} from={detail.from} to={detail.to} />;
    case "stash":
      return <StashDetailView cwd={cwd} hash={detail.hash} />;
  }
}

/** What a file's diff compares, as the header says it after the file's name. */
function useCompared(): (source: DiffSource, file: FileChange) => string {
  const { t } = useT();
  return (source, file) => {
    switch (source.kind) {
      case "commit":
        return shortRev(source.hash);
      case "incoming":
        return t("detail.source.incoming");
      case "outgoing":
        return t("detail.source.outgoing");
      case "stash":
        return t("detail.source.stash");
      case "compare":
        return t("detail.source.compare", { from: shortRev(source.from), to: shortRev(source.to) });
      case "staged":
        return file.status === "D" ? t("detail.source.deleted") : t("detail.source.staged");
      case "changes":
        return file.status === "D" ? t("detail.source.deleted") : file.status === "?" ? t("detail.source.untracked") : t("detail.source.workingTree");
    }
  };
}

/** The header's title: what is shown, its subject in git's words (a path, a hash, two revisions), dimmed parts muted. */
function Title({ detail }: { detail: Exclude<DetailTarget, { kind: "none" }> }) {
  const { t } = useT();
  const compared = useCompared();
  switch (detail.kind) {
    case "file": {
      const { name, folder } = splitPath(detail.file.path);
      const where = detail.file.from !== undefined ? `${detail.file.from} → ${detail.file.path}` : folder;
      return <Heading main={name} rest={where} tag={compared(detail.source, detail.file)} />;
    }
    case "conflict": {
      const { name, folder } = splitPath(detail.path);
      return <Heading main={name} rest={folder} tag={t("detail.header.conflict")} />;
    }
    case "commit":
      return <Heading main={t("detail.header.commit")} tag={shortRev(detail.hash)} />;
    case "fileHistory":
      return <Heading main={t("detail.header.fileHistory")} rest={detail.path} />;
    case "blame":
      return <Heading main={t("detail.header.blame")} rest={detail.path} tag={detail.rev !== undefined ? shortRev(detail.rev) : undefined} />;
    case "compare":
      return <Heading main={t("detail.header.compare")} tag={t("detail.source.compare", { from: shortRev(detail.from), to: shortRev(detail.to) })} />;
    case "stash":
      return <Heading main={t("detail.header.stash")} tag={shortRev(detail.hash)} />;
  }
}

/** A title in one line: the main words, what they are about dimmed after them, and a tag (what is compared). */
function Heading({ main, rest, tag }: { main: string; rest?: string; tag?: string }) {
  const th = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline", gap: th.space.sm, minWidth: 0 }}>
      <T weight="600" lines={1} selectable style={{ flexShrink: 1 }}>
        {main}
      </T>
      {tag !== undefined && tag !== "" && (
        <T size={th.small} tone="muted" lines={1} style={{ flexShrink: 0, maxWidth: "50%" }}>
          {tag}
        </T>
      )}
      {rest !== undefined && rest !== "" && (
        <T size={th.small} tone="muted" lines={1} selectable style={{ flexShrink: 1000, minWidth: 0 }}>
          {rest}
        </T>
      )}
    </View>
  );
}
