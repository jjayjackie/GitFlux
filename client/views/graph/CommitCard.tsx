// What VS Code's hover over a commit shows (and upstream's CommitCard in paseo-source-control: client/Graph.tsx): who made it and when,
// its full message, how much it changed, its refs and its hash. The message and the counts come from git.history.show,
// read once per commit (a commit never changes). Also the counts line the commit details reuse.

import { View } from "react-native";
import { historyShowRpc } from "../../../shared/rpc/history.ts";
import type { Ref, Stats } from "../../../shared/schemas.ts";
import { useT } from "../../i18n/messages.ts";
import { useFormatTime } from "../../state/format.ts";
import { useGitQuery } from "../../state/rpc.ts";
import * as codicon from "../../ui/codicons.ts";
import { ErrorNotice } from "../../ui/ErrorNotice.tsx";
import { Glyph } from "../../ui/Glyph.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { Spinner } from "../../ui/Spinner.tsx";
import { T } from "../../ui/Text.tsx";
import { useTheme } from "../../ui/theme.ts";
import { useCopy } from "./commitActions.ts";
import type { Followed } from "./model.ts";
import { shortHash } from "./model.ts";
import { RefBadges } from "./RefBadges.tsx";

/** Lines of the message a card shows before it is cut: the commit details show the rest. */
const CARD_MESSAGE_LINES = 20;

/** "3 files changed, 7 insertions(+), 1 deletion(-)", in VS Code's words and colours, leaving out a count of nothing. */
export function CommitStats({ stats, compact }: { stats: Stats; compact?: boolean }) {
  const th = useTheme();
  const { t } = useT();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: th.space.sm }}>
      <T size={compact ? th.small + 1 : undefined}>{compact ? t("graph.stats.filesShort", { count: stats.files }) : t("graph.stats.files", { count: stats.files })}</T>
      {stats.insertions > 0 && (
        <T size={compact ? th.small + 1 : undefined} tone="success">
          {compact ? t("graph.stats.added", { count: stats.insertions }) : t("graph.stats.insertions", { count: stats.insertions })}
        </T>
      )}
      {stats.deletions > 0 && (
        <T size={compact ? th.small + 1 : undefined} tone="danger">
          {compact ? t("graph.stats.removed", { count: stats.deletions }) : t("graph.stats.deletions", { count: stats.deletions })}
        </T>
      )}
    </View>
  );
}

export interface CommitCardProps {
  cwd: string;
  commit: { hash: string; author: string; time: number; refs: readonly Ref[] };
  lane: number;
  followed: Followed;
  current: string | null;
}

export function CommitCard({ cwd, commit, lane, followed, current }: CommitCardProps) {
  const th = useTheme();
  const { t } = useT();
  const formatTime = useFormatTime();
  const copy = useCopy();
  const detail = useGitQuery(historyShowRpc, { cwd, hash: commit.hash }, { staleTime: Infinity });
  const rule = <View style={{ height: 1, backgroundColor: th.c.border }} />;
  const when = t("graph.card.when", { relative: formatTime(commit.time, "relative"), absolute: formatTime(commit.time, "absolute") });
  return (
    <View style={{ gap: th.space.md, maxWidth: 520 }} testID="ag-graph-card">
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: th.space.xs }}>
        <Glyph icon={codicon.account} size={th.small + 3} color={th.c.foreground} />
        <T weight="600">{commit.author}</T>
        <Glyph icon={codicon.history} size={th.small + 3} color={th.c.foreground} />
        <T style={{ flexShrink: 1 }}>{when}</T>
      </View>
      {detail.error ? (
        <ErrorNotice error={detail.error} compact />
      ) : !detail.data ? (
        <Spinner />
      ) : (
        <>
          <T selectable lines={CARD_MESSAGE_LINES}>
            {detail.data.body.trimEnd()}
          </T>
          {rule}
          {detail.data.stats.files > 0 && (
            <>
              <CommitStats stats={detail.data.stats} />
              {rule}
            </>
          )}
        </>
      )}
      {commit.refs.length > 0 && (
        <>
          <RefBadges refs={commit.refs} lane={lane} followed={followed} current={current} still />
          {rule}
        </>
      )}
      <View style={{ flexDirection: "row", alignItems: "center", gap: th.space.xs }}>
        <Glyph icon={codicon.gitCommit} size={th.small + 3} />
        <T mono size={th.small} selectable>
          {shortHash(commit.hash)}
        </T>
        <IconButton icon={codicon.copy} label={t("graph.menu.copyHash")} onPress={() => copy(commit.hash, t("graph.copiedHash"))} testID="ag-graph-card-copy" />
      </View>
    </View>
  );
}
