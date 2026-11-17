// The quick branch switcher (the `switch-branch` command, Alt+B): a filter box over the local and remote branches;
// pressing one, or Enter for the first one listed, closes the switcher and checks it out (RefActions asks about local
// changes in the way). A remote branch is checked out as a local branch that tracks it.

import { useMemo, useState } from "react";
import { View } from "react-native";
import { branchListRpc } from "../../../shared/rpc/branch.ts";
import type { CheckoutTarget } from "../../../shared/rpc/branch.ts";
import { useT } from "../../i18n/messages.ts";
import { useGitQuery } from "../../state/rpc.ts";
import { Button } from "../../ui/Button.tsx";
import * as codicon from "../../ui/codicons.ts";
import { DialogFrame } from "../../ui/Dialog.tsx";
import type { DialogProps } from "../../ui/Dialog.tsx";
import { Glyph } from "../../ui/Glyph.tsx";
import { List } from "../../ui/List.tsx";
import { Row } from "../../ui/Row.tsx";
import { SearchField } from "../../ui/SearchField.tsx";
import { T } from "../../ui/Text.tsx";
import { useTheme } from "../../ui/theme.ts";

export interface SwitchBranchDialogProps {
  cwd: string;
  /** Checks a branch out; `label` names it in the messages. */
  onPick: (target: CheckoutTarget, label: string) => void;
}

interface Entry {
  key: string;
  kind: "local" | "remote";
  name: string;
  subject: string;
  target: CheckoutTarget;
}

/** Rows shown in the switcher's list. */
const VISIBLE_ROWS = 12;

export function SwitchBranchDialog({ open, onClose, cwd, onPick }: DialogProps & SwitchBranchDialogProps) {
  const th = useTheme();
  const { t } = useT();
  const [filter, setFilter] = useState("");
  const query = useGitQuery(branchListRpc, { cwd });
  const data = query.data;
  const entries = useMemo<Entry[]>(() => {
    if (!data) return [];
    const needle = filter.trim().toLowerCase();
    const keep = (name: string) => needle === "" || name.toLowerCase().includes(needle);
    const local: Entry[] = data.local
      .filter((branch) => !branch.current && keep(branch.name))
      .map((branch): Entry => ({ key: `l:${branch.name}`, kind: "local", name: branch.name, subject: branch.subject, target: { kind: "branch", name: branch.name } }));
    const remote: Entry[] = data.remote
      .filter((branch) => keep(branch.name))
      .map((branch): Entry => ({ key: `r:${branch.name}`, kind: "remote", name: branch.name, subject: branch.subject, target: { kind: "remote", name: branch.name } }));
    return [...local, ...remote];
  }, [data, filter]);

  const pick = (entry: Entry | undefined) => {
    if (!entry) return;
    onClose();
    onPick(entry.target, entry.name);
  };

  return (
    <DialogFrame
      open={open}
      onClose={onClose}
      title={t("branch.switcher.title")}
      icon="GitBranch"
      scrollable={false}
      testID="ag-switch-branch"
      footer={<Button label={t("common.cancel")} onPress={onClose} testID="ag-switch-branch-cancel" />}
    >
      <SearchField label={t("branch.switcher.filter")} value={filter} onChange={setFilter} onSubmit={() => pick(entries[0])} autoFocus testID="ag-switch-branch-filter" />
      <T size={th.small} tone="muted">
        {t("branch.switcher.hint")}
      </T>
      <View style={{ height: th.row * VISIBLE_ROWS, borderWidth: 1, borderColor: th.c.border, borderRadius: th.radius.sm, overflow: "hidden" }}>
        <List
          data={entries}
          keyOf={(entry) => entry.key}
          loading={query.isLoading}
          error={query.error}
          onRetry={() => void query.refetch()}
          empty={t("branch.switcher.empty")}
          testID="ag-switch-branch-list"
          renderRow={(entry, { index }) => (
            <Row
              accessibilityLabel={`${entry.kind === "local" ? t("branch.switcher.local") : t("branch.switcher.remote")}: ${entry.name}`}
              focused={index === 0 && filter.trim() !== ""}
              onPress={() => pick(entry)}
              testID={`ag-switch-branch-${entry.name}`}
            >
              <Glyph icon={entry.kind === "local" ? codicon.gitBranch : codicon.cloud} />
              <T lines={1} style={{ flexShrink: 1 }}>
                {entry.name}
              </T>
              <T lines={1} size={th.small} tone="muted" style={{ flex: 1, minWidth: 0 }}>
                {entry.subject}
              </T>
            </Row>
          )}
        />
      </View>
    </DialogFrame>
  );
}
