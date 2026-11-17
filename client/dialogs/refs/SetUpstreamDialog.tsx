// Set a branch's upstream: pick one of the remote-tracking branches (filtered as typed; the current upstream, or the
// one of the same name, is chosen at first).

import { useMemo, useState } from "react";
import { View } from "react-native";
import { branchListRpc, branchSetUpstreamRpc } from "../../../shared/rpc/branch.ts";
import { useT } from "../../i18n/messages.ts";
import { useGitMutation, useGitQuery } from "../../state/rpc.ts";
import * as codicon from "../../ui/codicons.ts";
import { FormDialog } from "../../ui/Dialog.tsx";
import type { DialogProps } from "../../ui/Dialog.tsx";
import { Glyph } from "../../ui/Glyph.tsx";
import { List } from "../../ui/List.tsx";
import { Row } from "../../ui/Row.tsx";
import { SearchField } from "../../ui/SearchField.tsx";
import { T } from "../../ui/Text.tsx";
import { useTheme } from "../../ui/theme.ts";

export interface SetUpstreamDialogProps {
  cwd: string;
  /** The local branch. */
  name: string;
  /** Its upstream now, if any. */
  upstream: string | null;
}

const VISIBLE_ROWS = 10;

export function SetUpstreamDialog({ open, onClose, cwd, name, upstream }: DialogProps & SetUpstreamDialogProps) {
  const th = useTheme();
  const { t } = useT();
  const [filter, setFilter] = useState("");
  const [chosen, setChosen] = useState<string | null>(upstream);
  const query = useGitQuery(branchListRpc, { cwd });
  const remote = query.data?.remote;
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return (remote ?? []).filter((branch) => needle === "" || branch.name.toLowerCase().includes(needle));
  }, [remote, filter]);
  // Until something is chosen: the branch of the same name on a remote, if there is one.
  const pick = chosen ?? remote?.find((branch) => branch.branch === name)?.name ?? null;
  const set = useGitMutation(branchSetUpstreamRpc, { cwd, label: "working", successMessage: pick ? t("branch.upstreamDialog.set", { name, upstream: pick }) : undefined });
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={t("branch.upstreamDialog.title", { name })}
      icon="GitBranch"
      submitLabel={t("branch.upstreamDialog.submit")}
      canSubmit={pick !== null && pick !== upstream && !set.disabled}
      onSubmit={() => (pick === null ? false : set.runAsync({ name, upstream: pick }))}
      scrollable={false}
      testID="ag-set-upstream"
    >
      <SearchField label={t("branch.upstreamDialog.filter")} value={filter} onChange={setFilter} autoFocus testID="ag-set-upstream-filter" />
      <View style={{ height: th.row * VISIBLE_ROWS, borderWidth: 1, borderColor: th.c.border, borderRadius: th.radius.sm, overflow: "hidden" }}>
        <List
          data={shown}
          keyOf={(branch) => branch.name}
          selectedKey={pick}
          loading={query.isLoading}
          error={query.error}
          onRetry={() => void query.refetch()}
          empty={t("branch.upstreamDialog.empty")}
          testID="ag-set-upstream-list"
          renderRow={(branch, { selected }) => (
            <Row accessibilityLabel={branch.name} accessibilityRole="radio" selected={selected} onPress={() => setChosen(branch.name)} testID={`ag-set-upstream-${branch.name}`}>
              <Glyph icon={codicon.cloud} />
              <T lines={1} weight={selected ? "600" : undefined} style={{ flex: 1, minWidth: 0 }}>
                {branch.name}
              </T>
            </Row>
          )}
        />
      </View>
      {pick !== null && (
        <T size={th.small + 1} tone="muted">
          {t("branch.upstreamDialog.chosen", { upstream: pick })}
        </T>
      )}
    </FormDialog>
  );
}
