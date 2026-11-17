// A commit in the detail column (`setDetail({ kind: "commit", hash })`): git.history.show's header — subject, the full
// message, author and committer with their emails and times, the hash, parents that open in turn, refs, signature and
// counts — the actions the graph's menu offers (the common ones as buttons, the rest under "⋯"), and below, the files it
// changed over the selected file's diff. The detail router (views/detail/index.tsx) draws the pane's title above it.

import { ScrollView } from "@getpaseo/plugin/client/ui";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { COMMIT_FILES_MAX } from "../../../../shared/limits.ts";
import { historyShowRpc } from "../../../../shared/rpc/history.ts";
import type { CommitDetail, FileChange, Person } from "../../../../shared/schemas.ts";
import { useT } from "../../../i18n/messages.ts";
import { useFormatTime } from "../../../state/format.ts";
import { useGitQuery } from "../../../state/rpc.ts";
import { useDetail } from "../../../state/selection.ts";
import { Button } from "../../../ui/Button.tsx";
import * as codicon from "../../../ui/codicons.ts";
import { EmptyState } from "../../../ui/EmptyState.tsx";
import { ErrorNotice } from "../../../ui/ErrorNotice.tsx";
import { isSeparator } from "../../../ui/floating/context.ts";
import type { MenuAction, MenuItem } from "../../../ui/floating/context.ts";
import { MoreButton } from "../../../ui/floating/Menu.tsx";
import { useHint } from "../../../ui/floating/Tooltip.tsx";
import { IconButton } from "../../../ui/IconButton.tsx";
import { Spinner } from "../../../ui/Spinner.tsx";
import { SplitPane } from "../../../ui/SplitPane.tsx";
import { T } from "../../../ui/Text.tsx";
import { useTheme } from "../../../ui/theme.ts";
import { FileTree } from "../../files/FileTree.tsx";
import { CommitStats } from "../../graph/CommitCard.tsx";
import { COMMIT_ACTION, useCommitActions, useCopy, useRepoStatus } from "../../graph/commitActions.ts";
import { useLoadedCommits } from "../../graph/loaded.ts";
import { ancestry } from "../../graph/model.ts";
import type { Followed } from "../../graph/model.ts";
import { RefBadges } from "../../graph/RefBadges.tsx";
import { FileDiffView } from "../diff/FileDiffView.tsx";
import { useFileMenu } from "./fileMenu.ts";
import { useSplitSize } from "./split.ts";

/** The actions drawn as buttons; the rest go under "⋯". */
const BUTTONS: readonly string[] = [COMMIT_ACTION.cherryPick, COMMIT_ACTION.revert, COMMIT_ACTION.createBranch, COMMIT_ACTION.createTag, COMMIT_ACTION.reset];

const SIGNATURE_LABELS = {
  good: "detail.commitPane.signature.good",
  untrusted: "detail.commitPane.signature.untrusted",
  bad: "detail.commitPane.signature.bad",
  expired: "detail.commitPane.signature.expired",
  "expired-key": "detail.commitPane.signature.expiredKey",
  revoked: "detail.commitPane.signature.revoked",
  unverifiable: "detail.commitPane.signature.unverifiable",
} as const;

/** Menu entries without separators at either end or two in a row. */
export function tidyMenu(items: readonly MenuItem[]): MenuItem[] {
  const out: MenuItem[] = [];
  for (const item of items) {
    if (isSeparator(item) && (out.length === 0 || isSeparator(out[out.length - 1]))) continue;
    out.push(item);
  }
  while (out.length > 0 && isSeparator(out[out.length - 1])) out.pop();
  return out;
}

export function CommitDetailView({ cwd, hash }: { cwd: string; hash: string }) {
  const th = useTheme();
  const { t } = useT();
  const detail = useGitQuery(historyShowRpc, { cwd, hash }, { staleTime: Infinity });
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [infoSize, setInfoSize] = useSplitSize("detail.commitInfo");
  const [filesSize, setFilesSize] = useSplitSize("detail.commitFiles");
  const fileMenu = useFileMenu(cwd, hash);

  if (detail.error && !detail.data) return <ErrorNotice error={detail.error} onRetry={() => void detail.refetch()} testID="ag-commit-error" />;
  if (!detail.data) return <Spinner label={t("common.loading")} />;
  const data = detail.data;
  const files = data.files;
  const selected = files.find((file) => file.path === selectedPath) ?? files[0] ?? null;

  const list = (
    <View style={{ flex: 1, minHeight: 0 }}>
      {data.filesTruncated && (
        <T size={th.small} tone="warning" style={{ paddingHorizontal: th.space.md, paddingVertical: th.space.xs }}>
          {t("detail.commitPane.filesTruncated", { count: COMMIT_FILES_MAX })}
        </T>
      )}
      <FileTree
        treeId={`commit-${hash}`}
        files={files}
        selectedPath={selected?.path ?? null}
        onOpen={(file: FileChange) => setSelectedPath(file.path)}
        fileMenu={fileMenu}
        empty={<EmptyState compact title={t("detail.commitPane.noFiles")} />}
        testID="ag-commit-files"
      />
    </View>
  );
  const diff = selected ? (
    <FileDiffView key={selected.path} embedded cwd={cwd} source={{ kind: "commit", hash: data.hash }} file={selected} />
  ) : (
    <EmptyState compact title={t("detail.commitPane.selectFile")} />
  );
  return (
    <View testID="ag-commit-detail" style={{ flex: 1, minHeight: 0 }}>
      <SplitPane
        direction="vertical"
        first={
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: th.space.md, gap: th.space.md }}>
            <Header cwd={cwd} data={data} />
          </ScrollView>
        }
        second={
          <SplitPane
            direction="vertical"
            first={list}
            second={diff}
            size={filesSize}
            onSize={setFilesSize}
            defaultRatio={0.35}
            min={th.row * 3}
            minOther={th.row * 4}
            label={t("detail.commitPane.resizeFiles")}
            hint={t("shell.resetSize")}
            testID="ag-commit-split-files"
          />
        }
        size={infoSize}
        onSize={setInfoSize}
        defaultRatio={0.3}
        min={th.row * 3}
        minOther={th.row * 6}
        label={t("detail.commitPane.resizeInfo")}
        hint={t("shell.resetSize")}
        testID="ag-commit-split-info"
      />
    </View>
  );
}

function Header({ cwd, data }: { cwd: string; data: CommitDetail }) {
  const th = useTheme();
  const { t } = useT();
  const copy = useCopy();
  const status = useRepoStatus(cwd);
  const loaded = useLoadedCommits(cwd);
  const actions = useCommitActions(cwd);
  const head = status.data?.head ?? null;
  const followed = useMemo<Followed>(() => ({ upstream: status.data?.upstream ?? null, base: status.data?.base ?? null, all: false }), [status.data?.upstream, status.data?.base]);
  const items = actions({ hash: data.hash, subject: data.subject, refs: data.refs, ancestry: ancestry([...loaded.values()], head, data.hash) });
  const buttons = BUTTONS.map((id) => items.find((item): item is MenuAction => !isSeparator(item) && item.id === id)).filter((item): item is MenuAction => item !== undefined);
  const rest = tidyMenu(items.filter((item) => isSeparator(item) || !BUTTONS.includes(item.id)));
  const message = data.body.startsWith(data.subject) ? data.body.slice(data.subject.length).replace(/^\s*\n/, "").trimEnd() : data.body.trimEnd();
  const sameCommitter = data.committer.name === data.author.name && data.committer.email === data.author.email && data.committer.time === data.author.time;
  const signature = data.signature;
  return (
    <>
      <View style={{ gap: th.space.xs }}>
        <T weight="600" size={th.title} selectable testID="ag-commit-subject">
          {data.subject}
        </T>
        {message !== "" && (
          <T selectable mono size={th.small + 1} testID="ag-commit-body">
            {message}
          </T>
        )}
      </View>
      <View style={{ gap: th.space.xs }}>
        <PersonLine label={t("detail.commitPane.author")} person={data.author} />
        {!sameCommitter && <PersonLine label={t("detail.commitPane.committer")} person={data.committer} />}
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: th.space.sm }}>
          <T size={th.small + 1} tone="muted">
            {t("detail.commitPane.hash")}
          </T>
          <T size={th.small + 1} mono selectable testID="ag-commit-hash">
            {data.hash}
          </T>
          <IconButton icon={codicon.copy} label={t("graph.menu.copyHash")} onPress={() => copy(data.hash, t("graph.copiedHash"))} testID="ag-commit-copy-hash" />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: th.space.sm }}>
          <T size={th.small + 1} tone="muted">
            {data.parents.length > 1 ? t("detail.commitPane.parents") : t("detail.commitPane.parent")}
          </T>
          {data.parents.length === 0 ? (
            <T size={th.small + 1} tone="muted">
              {t("detail.commitPane.root")}
            </T>
          ) : (
            data.parents.map((parent) => <ParentLink key={parent} hash={parent} />)
          )}
        </View>
        {signature !== null && signature !== undefined && (
          <T size={th.small + 1} tone={signature.status === "good" ? "success" : signature.status === "untrusted" ? "warning" : "danger"} testID="ag-commit-signature">
            {signature.signer ? t("detail.commitPane.signedBy", { status: t(SIGNATURE_LABELS[signature.status]), signer: signature.signer }) : t(SIGNATURE_LABELS[signature.status])}
          </T>
        )}
        {data.refs.length > 0 && <RefBadges refs={data.refs} lane={0} followed={followed} current={status.data?.branch ?? null} testID="ag-commit-refs" />}
        <CommitStats stats={data.stats} compact />
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: th.space.sm }}>
        {buttons.map((item) => (
          <Button
            key={item.id}
            small
            label={item.label}
            icon={item.icon}
            disabled={item.disabled}
            reason={item.reason}
            onPress={() => item.onPress?.()}
            testID={`ag-commit-action-${item.id}`}
          />
        ))}
        <MoreButton items={rest} testID="ag-commit-more" />
      </View>
    </>
  );
}

function PersonLine({ label, person }: { label: string; person: Person }) {
  const th = useTheme();
  const { t } = useT();
  const formatTime = useFormatTime();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: th.space.sm }}>
      <T size={th.small + 1} tone="muted">
        {label}
      </T>
      <T size={th.small + 1} selectable>
        {t("detail.commitPane.person", { name: person.name, email: person.email })}
      </T>
      <T size={th.small + 1} tone="muted">
        {t("detail.commitPane.when", { relative: formatTime(person.time, "relative"), absolute: formatTime(person.time, "absolute") })}
      </T>
    </View>
  );
}

function ParentLink({ hash }: { hash: string }) {
  const th = useTheme();
  const { t } = useT();
  const [, setDetail] = useDetail();
  const label = t("detail.commitPane.openParent", { hash: hash.slice(0, 7) });
  const hover = useHint(label);
  return (
    <Pressable {...hover} accessibilityRole="link" accessibilityLabel={label} onPress={() => setDetail({ kind: "commit", hash })} testID={`ag-commit-parent-${hash}`}>
      <T size={th.small + 1} mono tone="accent">
        {hash.slice(0, 7)}
      </T>
    </Pressable>
  );
}
