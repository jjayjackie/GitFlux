// The navigation column (architecture §9): repositories, branches, remotes, tags, stashes, worktrees, submodules, with a
// filter. Owned by the navigation view agent, who replaces this body and adds files beside it; layout/Panel.tsx renders
// `NavView` with these props and is not edited.
//
// THIS ROUND: a real, minimal repository list (so the panel is usable), and a notice for the rest.

import { View } from "react-native";
import type { Repository } from "../../../shared/schemas.ts";
import { useT } from "../../i18n/messages.ts";
import { useCollapsed } from "../../state/view.ts";
import { Badge } from "../../ui/Badge.tsx";
import * as codicon from "../../ui/codicons.ts";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { Tooltip } from "../../ui/floating/Tooltip.tsx";
import { Glyph } from "../../ui/Glyph.tsx";
import { List } from "../../ui/List.tsx";
import { Row } from "../../ui/Row.tsx";
import { Section } from "../../ui/Section.tsx";
import { T } from "../../ui/Text.tsx";
import { useTheme } from "../../ui/theme.ts";

export interface NavViewProps {
  /** Every repository discovery listed (git.repo.discover), parent first, plus the enclosing one when asked for. */
  repositories: readonly Repository[];
  /** The one the panel shows. */
  selected: Repository;
  /** Shows another repository (by its root). */
  onSelect: (root: string) => void;
  /** The selected repository's root: the `cwd` of every call about it. */
  cwd: string;
  /** Discovery stopped at SCAN_MAX_REPOSITORIES. */
  truncated: boolean;
}

export function NavView({ repositories, selected, onSelect, truncated }: NavViewProps) {
  const th = useTheme();
  const { t } = useT();
  const [collapsed, toggle] = useCollapsed("nav.repositories");
  return (
    <View style={{ flex: 1, minHeight: 0 }} testID="ag-nav">
      <Section title={t("shell.repositories")} count={repositories.length} collapsed={collapsed} onToggle={toggle} fill testID="ag-section-repositories">
        <List
          data={repositories}
          keyOf={(repository) => repository.root}
          selectedKey={selected.root}
          testID="ag-repository-list"
          renderRow={(repository, { selected: isSelected }) => (
            <Row
              accessibilityLabel={repository.name}
              selected={isSelected}
              indent={Math.min(repository.depth, 6) * 8}
              onPress={() => onSelect(repository.root)}
              testID={`ag-repository-${repository.name}`}
            >
              <Glyph icon={isSelected ? codicon.repoSelected : codicon.repo} />
              <T lines={1} style={{ flexShrink: 1 }}>
                {repository.name}
              </T>
              {repository.branch !== null && (
                <T lines={1} size={th.small} tone="muted" style={{ flexShrink: 2 }}>
                  {repository.branch}
                </T>
              )}
              <View style={{ flex: 1 }} />
              {repository.failed !== null ? (
                <Tooltip text={repository.failed}>
                  <Glyph icon="CircleAlert" color={th.c.statusDanger} size={th.icon - 2} />
                </Tooltip>
              ) : (
                <Badge ahead={repository.ahead} behind={repository.behind} />
              )}
            </Row>
          )}
          footer={truncated ? <EmptyState compact title={t("panel.discoveryTruncated", { count: repositories.length })} /> : undefined}
        />
      </Section>
      <EmptyState compact title={t("panel.coming", { area: t("shell.branches") })} testID="ag-nav-placeholder" />
    </View>
  );
}
