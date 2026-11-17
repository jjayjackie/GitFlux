// A file in conflict (git.conflict.sides): which side is which, in git's words, and what can be done with it — take a
// side whole, mark it resolved once no marker is left, delete it, or open it to edit by hand. Three tabs below:
//   Result — the work-tree file with its markers, each conflict block tinted as VS Code tints it, with "Use current",
//            "Use incoming" and "Use both" per block rewriting that block in a draft that "Save result" writes and
//            stages (git.conflict.resolve `content`); or the draft edited as text;
//   Current vs incoming — the two sides compared with the diff's own renderer (a line diff made here: the daemon's
//            compares files in the repository only);
//   Base — the common ancestor, when there is one.
// VS Code's merge-conflict colours (extensions/merge-conflict, merge.* colours) tint the blocks: the theme has none.

import { useMemo, useState } from "react";
import { FlatList, ScrollView, View } from "react-native";
import { CONFLICT_EDIT_MAX_CHARS, CONFLICT_SIDE_MAX_BYTES } from "../../../../shared/limits.ts";
import { changesMarkersRpc } from "../../../../shared/rpc/changes.ts";
import { conflictResolveRpc, conflictSidesRpc } from "../../../../shared/rpc/conflict.ts";
import type { ConflictSides } from "../../../../shared/rpc/conflict.ts";
import { repoStatusRpc } from "../../../../shared/rpc/repo.ts";
import { useT } from "../../../i18n/messages.ts";
import { usePrefs } from "../../../state/prefs.ts";
import { useGitMutation, useGitQuery } from "../../../state/rpc.ts";
import { useViewExtra } from "../../../state/view.ts";
import { Banner, Button, codicon, EmptyState, ErrorNotice, Loading, T, Tabs, TextField, useDialogs, useOpenFile, useTheme, useToast } from "../../../ui/index.ts";
import { DiffBody } from "../diff/DiffBody.tsx";
import type { Found } from "../diff/DiffBody.tsx";
import { SPLIT_MIN } from "../diff/FileDiffView.tsx";
import { lineDiff, textLines } from "../diff/lineDiff.ts";
import { codeMetrics, lineColumns, numberWidth } from "../diff/wrap.ts";
import { conflictCount, hasConflictMarkers, parseConflicts, resolveBlock, splitKeepingBreaks } from "./markers.ts";
import type { BlockChoice } from "./markers.ts";

export interface ConflictViewProps {
  cwd: string;
  path: string;
}

const TABS = ["result", "sides", "base"] as const;
type Tab = (typeof TABS)[number];

const REFRESH_MS = 3000;
/** The most pixels unwrapped result lines are drawn across. */
const MAX_WIDTH = 200_000;

/**
 * VS Code's merge-conflict colours, the same in its dark and light themes (merge.currentHeaderBackground and
 * …ContentBackground, merge.incoming…, merge.common…).
 */
const TINTS = {
  oursHeader: "#40C8AE80",
  ours: "#40C8AE33",
  theirsHeader: "#40A6FF80",
  theirs: "#40A6FF33",
  baseHeader: "#60606066",
  base: "#60606029",
} as const;
type Tint = keyof typeof TINTS;

export function ConflictView({ cwd, path }: ConflictViewProps) {
  const th = useTheme();
  const { t } = useT();
  const toast = useToast();
  const dialogs = useDialogs();
  const openFile = useOpenFile();
  const { prefs } = usePrefs();
  const [tab, setTab] = useViewExtra<Tab>("conflict.tab", "result", TABS);
  const [draft, setDraft] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [width, setWidth] = useState(0);

  const status = useGitQuery(repoStatusRpc, { cwd }, { refetchInterval: (data) => (data?.cutAt ? false : REFRESH_MS) });
  const resolved = status.data !== undefined && status.data.cutAt === null && !status.data.conflicts.some((file) => file.path === path);
  const sides = useGitQuery(conflictSidesRpc, resolved ? null : { cwd, path }, { refetchInterval: REFRESH_MS });
  const markers = useGitQuery(changesMarkersRpc, resolved ? null : { cwd, paths: [path] }, { refetchInterval: REFRESH_MS });

  const resolve = useGitMutation(conflictResolveRpc, { cwd, label: "resolving" });
  const remove = useGitMutation(conflictResolveRpc, { cwd, label: "deleting" });

  const data = sides.data;
  const merged = data?.merged ?? null;
  const text = draft ?? merged;
  const edited = draft !== null && draft !== merged;
  const markersLeft = merged !== null && hasConflictMarkers(merged);

  if (resolved) return <EmptyState icon={codicon.check} title={t("conflict.resolved")} body={t("conflict.resolvedHint")} testID="ag-conflict-resolved" />;
  if (sides.error) return <ErrorNotice error={sides.error} onRetry={() => void sides.refetch()} testID="ag-conflict-error" />;
  if (!data) return <Loading />;

  const take = (resolution: "ours" | "theirs") => {
    const sent = resolution === "ours" ? resolve.run({ paths: [path], resolution: "ours" }) : resolve.run({ paths: [path], resolution: "theirs" });
    void sent.then((result) => result.status === "ok" && setDraft(null));
  };
  const markResolved = async () => {
    // Checked here, and again by the daemon on the file as it is now: it may have been edited since it was read.
    const fresh = await markers.refetch();
    if (fresh.data?.paths.includes(path)) {
      toast.show(t("conflict.markersLeft"), { variant: "warning" });
      return;
    }
    void resolve.run({ paths: [path], resolution: "mark-resolved" });
  };
  const deleteFile = () =>
    void dialogs.confirm({
      title: t("conflict.deleteTitle", { path }),
      body: t("conflict.deleteBody"),
      lost: [path],
      confirmLabel: t("conflict.delete"),
      danger: true,
      testID: "ag-conflict-delete-confirm",
      onConfirm: () => remove.runAsync({ paths: [path], resolution: "delete", confirm: true }),
    });
  const save = () => {
    if (draft === null) return;
    void resolve.run({ path, resolution: "content", content: draft }).then((result) => result.status === "ok" && setDraft(null));
  };

  const markReason = edited ? t("conflict.saveFirst") : markersLeft || (markers.data?.paths.includes(path) ?? false) ? t("conflict.markersLeft") : resolve.reason;
  const draftMarkers = draft !== null && hasConflictMarkers(draft);
  const tooLong = draft !== null && draft.length > CONFLICT_SIDE_MAX_BYTES;
  const saveReason = !edited ? t("conflict.nothingToSave") : draftMarkers ? t("conflict.resolveAllFirst") : tooLong ? t("conflict.tooLongToSave") : data.truncated ? t("conflict.truncated") : resolve.reason;

  return (
    <View
      testID="ag-conflict"
      style={{ flex: 1, minHeight: 0 }}
      onLayout={(event) => {
        const next = event.nativeEvent.layout.width;
        if (next) setWidth(next);
      }}
    >
      <View style={{ paddingHorizontal: th.space.md, paddingVertical: th.space.sm, gap: th.space.sm, borderBottomWidth: 1, borderColor: th.c.border }}>
        <SideLabel title={t("conflict.current")} label={data.oursLabel} tint={TINTS.oursHeader} testID="ag-conflict-ours-label" />
        <SideLabel title={t("conflict.incoming")} label={data.theirsLabel} tint={TINTS.theirsHeader} testID="ag-conflict-theirs-label" />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: th.space.sm }}>
          <Button
            small
            label={t("conflict.acceptCurrent")}
            hint={data.ours === null && !data.binary ? t("conflict.acceptDeletes") : t("conflict.acceptCurrentHint")}
            disabled={resolve.disabled}
            reason={resolve.reason}
            onPress={() => take("ours")}
            testID="ag-conflict-accept-ours"
          />
          <Button
            small
            label={t("conflict.acceptIncoming")}
            hint={data.theirs === null && !data.binary ? t("conflict.acceptDeletes") : t("conflict.acceptIncomingHint")}
            disabled={resolve.disabled}
            reason={resolve.reason}
            onPress={() => take("theirs")}
            testID="ag-conflict-accept-theirs"
          />
          {!data.binary && (
            <Button
              small
              variant="primary"
              icon={codicon.check}
              label={t("conflict.markResolved")}
              disabled={markReason !== null || merged === null}
              reason={merged === null ? t("conflict.noWorkTreeFile") : markReason}
              onPress={() => void markResolved()}
              testID="ag-conflict-mark-resolved"
            />
          )}
          <Button small variant="danger" icon={codicon.discard} label={t("conflict.deleteAction")} disabled={remove.disabled} reason={remove.reason} onPress={deleteFile} testID="ag-conflict-delete" />
          {openFile && merged !== null && (
            <Button small variant="ghost" icon={codicon.goToFile} label={t("conflict.openFile")} onPress={() => openFile(`${cwd.replace(/[\\/]+$/, "")}/${path}`)} testID="ag-conflict-open" />
          )}
        </View>
      </View>
      {data.binary ? (
        <EmptyState icon={codicon.file} title={t("conflict.binary")} body={t("conflict.binaryHint")} testID="ag-conflict-binary" />
      ) : (
        <>
          {data.truncated && <Banner tone="warning" text={t("conflict.truncatedNotice")} testID="ag-conflict-truncated" />}
          <Tabs
            label={t("conflict.tabs")}
            value={tab}
            tabs={[
              { value: "result", label: t("conflict.tabResult"), count: text !== null ? conflictCount(parseConflicts(text)) : undefined },
              { value: "sides", label: t("conflict.tabSides") },
              { value: "base", label: t("conflict.tabBase"), disabled: data.base === null, hint: data.base === null ? t("conflict.noBase") : undefined },
            ]}
            onChange={setTab}
            testID="ag-conflict-tabs"
          />
          {tab === "result" &&
            (text === null ? (
              <EmptyState title={t("conflict.noWorkTreeFile")} testID="ag-conflict-no-file" />
            ) : (
              <>
                <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: th.space.sm, paddingHorizontal: th.space.md, paddingVertical: th.space.xs, borderBottomWidth: 1, borderColor: th.c.border }}>
                  <T size={th.small + 1} tone="muted" style={{ flex: 1, minWidth: 120 }}>
                    {edited ? t("conflict.draftEdited") : t("conflict.draftHint")}
                  </T>
                  {text.length <= CONFLICT_EDIT_MAX_CHARS && !data.truncated && (
                    <Button small variant="ghost" label={editing ? t("conflict.showBlocks") : t("conflict.editAsText")} onPress={() => setEditing(!editing)} testID="ag-conflict-edit-text" />
                  )}
                  {edited && <Button small variant="ghost" label={t("conflict.discardDraft")} onPress={() => setDraft(null)} testID="ag-conflict-discard-draft" />}
                  <Button
                    small
                    variant="primary"
                    label={t("conflict.saveResult")}
                    disabled={saveReason !== null}
                    reason={saveReason}
                    busy={resolve.pending}
                    onPress={save}
                    testID="ag-conflict-save"
                  />
                </View>
                {editing && text.length <= CONFLICT_EDIT_MAX_CHARS && !data.truncated ? (
                  <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: th.space.md }}>
                    <TextField label={t("conflict.resultText")} hideLabel value={text} onChange={setDraft} multiline minLines={12} maxLines={40} mono testID="ag-conflict-text" />
                  </ScrollView>
                ) : (
                  <ResultLines text={text} fontSize={prefs.codeFontSize} disabled={data.truncated} onChoose={(index, choice) => setDraft(resolveBlock(text, index, choice))} />
                )}
              </>
            ))}
          {tab === "sides" && <Sides data={data} width={width} />}
          {tab === "base" &&
            (data.base === null ? (
              <EmptyState title={t("conflict.noBase")} testID="ag-conflict-no-base" />
            ) : (
              <PlainText key="base" text={data.base} />
            ))}
        </>
      )}
    </View>
  );
}

/** "Current: HEAD", the title translated and git's label as git wrote it. */
function SideLabel({ title, label, tint, testID }: { title: string; label: string; tint: string; testID: string }) {
  const th = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: th.space.sm }} testID={testID}>
      <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: tint }} />
      <T size={th.small + 1} weight="600">
        {title}
      </T>
      <T size={th.small + 1} mono selectable lines={1} style={{ flex: 1, minWidth: 0 }}>
        {label}
      </T>
    </View>
  );
}

type ResultRow =
  | { kind: "line"; key: string; number: number; text: string; tint: Tint | null }
  | { kind: "block"; key: string; index: number; total: number };

/** The result's rows: each line, and before each conflict block a bar with its buttons. */
function resultRows(text: string): ResultRow[] {
  const parts = parseConflicts(text);
  const total = conflictCount(parts);
  const rows: ResultRow[] = [];
  let number = 0;
  const add = (chunk: string, tint: Tint | null) => {
    for (const line of splitKeepingBreaks(chunk)) {
      number++;
      rows.push({ kind: "line", key: `l${number}`, number, text: line.replace(/\r?\n$/, ""), tint });
    }
  };
  for (const part of parts) {
    if (part.kind === "text") {
      add(part.text, null);
      continue;
    }
    rows.push({ kind: "block", key: `b${part.index}`, index: part.index, total });
    // The block's own lines, as they are in the file: markers in the header tints, each side's lines in its own.
    const lines = splitKeepingBreaks(part.raw);
    let stage: "ours" | "base" | "theirs" = "ours";
    lines.forEach((line, n) => {
      const bareLine = line.replace(/\r?\n$/, "");
      let tint: Tint;
      if (n === 0) tint = "oursHeader";
      else if (n === lines.length - 1) tint = "theirsHeader";
      else if (stage === "ours" && part.base !== null && /^\|{7}(?:\s|$)/.test(bareLine)) {
        stage = "base";
        tint = "baseHeader";
      } else if (stage !== "theirs" && /^={7}$/.test(bareLine)) {
        stage = "theirs";
        tint = "baseHeader";
      } else tint = stage;
      add(line, tint);
    });
  }
  return rows;
}

/** The result, line by line, virtualised; each conflict block tinted, with its buttons above it. */
function ResultLines({ text, fontSize, disabled, onChoose }: { text: string; fontSize: number; disabled: boolean; onChoose: (index: number, choice: BlockChoice) => void }) {
  const th = useTheme();
  const { t } = useT();
  const code = useMemo(() => th.code(fontSize), [th, fontSize]);
  const metrics = codeMetrics(fontSize);
  const rows = useMemo(() => resultRows(text), [text]);
  const bar = th.row + 8;
  const digits = numberWidth(fontSize, rows.length);
  // Estimated, not measured: these lines do not wrap, and the width only decides how far they scroll sideways.
  const widths = { half: fontSize * 0.6, full: fontSize * 1.2 };
  const across = useMemo(() => {
    let longest = 0;
    for (const row of rows) if (row.kind === "line") longest = Math.max(longest, lineColumns(row.text, widths));
    return Math.min(MAX_WIDTH, digits + longest * widths.half + 16);
  }, [rows, digits, fontSize]);
  const starts = useMemo(() => {
    const at = new Float64Array(rows.length + 1);
    rows.forEach((row, index) => (at[index + 1] = at[index] + (row.kind === "block" ? bar : metrics.lineHeight)));
    return at;
  }, [rows, bar, metrics.lineHeight]);
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const draw = (row: ResultRow) => {
    if (row.kind === "block")
      return (
        <View
          testID={`ag-conflict-block-${row.index}`}
          style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: th.space.sm, paddingHorizontal: th.space.sm, backgroundColor: th.c.surface1, borderTopWidth: 1, borderColor: th.c.border }}
        >
          <T size={th.small} tone="muted" lines={1}>
            {t("conflict.blockOf", { current: row.index + 1, total: row.total })}
          </T>
          <Button small variant="ghost" label={t("conflict.useCurrent")} disabled={disabled} reason={disabled ? t("conflict.truncated") : null} onPress={() => onChoose(row.index, "ours")} testID={`ag-conflict-block-${row.index}-ours`} />
          <Button small variant="ghost" label={t("conflict.useIncoming")} disabled={disabled} reason={disabled ? t("conflict.truncated") : null} onPress={() => onChoose(row.index, "theirs")} testID={`ag-conflict-block-${row.index}-theirs`} />
          <Button small variant="ghost" label={t("conflict.useBoth")} disabled={disabled} reason={disabled ? t("conflict.truncated") : null} onPress={() => onChoose(row.index, "both")} testID={`ag-conflict-block-${row.index}-both`} />
        </View>
      );
    const label = String(row.number);
    return (
      <View style={{ flex: 1, flexDirection: "row", backgroundColor: row.tint ? TINTS[row.tint] : undefined }}>
        <T selectable={false} color={th.c.foregroundMuted} style={[code, { width: digits, paddingRight: 8, textAlign: "right" }]}>
          {label}
        </T>
        <T selectable lines={1} style={[code, { flex: 1 }]}>
          {row.text}
        </T>
      </View>
    );
  };
  const list = (
    <FlatList
      style={{ flex: 1 }}
      data={rows}
      keyExtractor={(row) => row.key}
      getItemLayout={(_, index) => ({ length: starts[index + 1] - starts[index], offset: starts[index], index })}
      initialNumToRender={Math.max(1, Math.ceil(frame.height / metrics.lineHeight))}
      renderItem={({ item, index }) => <View style={{ height: starts[index + 1] - starts[index] }}>{draw(item)}</View>}
      testID="ag-conflict-result"
    />
  );
  return (
    <View
      style={{ flex: 1, minHeight: 0 }}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        if (width) setFrame({ width, height });
      }}
    >
      {frame.width > 0 &&
        (across <= frame.width ? (
          list
        ) : (
          <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ width: across }}>
            <View style={{ width: across, height: frame.height }}>{list}</View>
          </ScrollView>
        ))}
    </View>
  );
}

/** Current against incoming, laid out as a diff; side by side as plain text when they are too far apart to compare. */
function Sides({ data, width }: { data: ConflictSides; width: number }) {
  const th = useTheme();
  const { t } = useT();
  const { prefs } = usePrefs();
  const found = useMemo((): Found | null => {
    if (data.ours === null || data.theirs === null) return null;
    const [original, modified] = [textLines(data.ours), textLines(data.theirs)];
    const changes = lineDiff(original, modified);
    return changes === null ? null : { kind: "diff", original, modified, changes, hitTimeout: false, truncated: false };
  }, [data.ours, data.theirs]);
  const sideBySide = prefs.diffMode === "split" && width >= SPLIT_MIN;
  if (data.ours === null || data.theirs === null) {
    const present = data.ours ?? data.theirs;
    return (
      <View style={{ flex: 1, minHeight: 0 }}>
        <Banner tone="info" text={data.ours === null ? t("conflict.deletedInCurrent") : t("conflict.deletedInIncoming")} testID="ag-conflict-one-side" />
        {present !== null && <PlainText key="present" text={present} />}
      </View>
    );
  }
  if (found === null)
    return (
      <View style={{ flex: 1, minHeight: 0 }}>
        <Banner tone="info" text={t("conflict.tooFarApart")} testID="ag-conflict-too-far" />
        <View style={{ flex: 1, minHeight: 0, flexDirection: "row" }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <PlainText key="ours" text={data.ours} />
          </View>
          <View style={{ width: 1, backgroundColor: th.c.border }} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <PlainText key="theirs" text={data.theirs} />
          </View>
        </View>
      </View>
    );
  return (
    <DiffBody found={found} sideBySide={sideBySide} collapse={prefs.diffHideUnchanged} wrap={prefs.diffWrap} fontSize={prefs.codeFontSize} testID="ag-conflict-sides" />
  );
}

/** A text drawn as a file, with line numbers, in the diff's renderer. */
function PlainText({ text }: { text: string }) {
  const { prefs } = usePrefs();
  const found = useMemo((): Found => ({ kind: "file", lines: textLines(text), truncated: false }), [text]);
  return <DiffBody found={found} sideBySide={false} collapse={false} wrap={prefs.diffWrap} fontSize={prefs.codeFontSize} />;
}
