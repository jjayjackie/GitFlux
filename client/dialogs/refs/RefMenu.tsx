// The menu of a ref badge in the graph or a commit's details: the same entries as the ref's row in the navigation
// (refMenus.ts), built from what the badge names. Mounted once around the shell (layout/Panel.tsx), so that a badge
// does not hold mutations of its own; a badge outside it (a hover card) has no menu.
//
// Usage:
//   <RefMenuProvider repository={selected}>{shell}</RefMenuProvider>
//   const menuFor = useRefMenu();                      // in a badge
//   menu.open(anchor, () => menuFor?.(ref) ?? []);

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { branchListRpc } from "../../../shared/rpc/branch.ts";
import type { BranchEntry, Ref, Repository } from "../../../shared/schemas.ts";
import { useT } from "../../i18n/messages.ts";
import { useGitQuery } from "../../state/rpc.ts";
import { useDetail, useDispatch } from "../../state/selection.ts";
import { useDialogs } from "../../ui/Dialog.tsx";
import type { MenuItem } from "../../ui/floating/context.ts";
import { useRepoStatus } from "../../views/graph/commitActions.ts";
import { useGraphOnly } from "../../views/graph/only.ts";
import { useCopy, useGates, useNavActions } from "../../views/nav/env.ts";
import { branchMenu, remoteBranchMenu, tagMenu } from "./refMenus.ts";
import type { RefMenuEnv } from "./refMenus.ts";

export type RefMenuFor = (ref: Ref) => MenuItem[];

const RefMenuContext = createContext<RefMenuFor | null>(null);

/** The menu of a ref badge; null outside the provider. */
export function useRefMenu(): RefMenuFor | null {
  return useContext(RefMenuContext);
}

/** A branch the list has not read (yet): what a badge knows of it. The daemon still refuses what it must. */
function bareBranch(name: string, current: boolean): BranchEntry {
  return { name, hash: "0".repeat(40), upstream: null, upstreamGone: false, ahead: 0, behind: 0, current, worktree: null, time: 0, subject: "", protected: false };
}

export interface RefMenuProviderProps {
  /** The selected repository, as discovery read it. */
  repository: Repository;
  children: ReactNode;
}

export function RefMenuProvider({ repository, children }: RefMenuProviderProps) {
  const cwd = repository.root;
  const { t } = useT();
  const [, setDetail] = useDetail();
  const dispatch = useDispatch();
  const dialogs = useDialogs();
  const copy = useCopy();
  const gate = useGates();
  const actions = useNavActions(cwd);
  const graph = useGraphOnly(cwd);
  const status = useRepoStatus(cwd);
  const branches = useGitQuery(branchListRpc, { cwd }, { staleTime: 5_000 });
  const current = status.data ? status.data.branch : repository.branch;
  const env: RefMenuEnv = { cwd, current, dispatch, dialogs, setDetail, copy, gate, actions, graph };

  const menuFor: RefMenuFor = (ref) => {
    const list = branches.data;
    switch (ref.kind) {
      case "head":
      case "branch": {
        if (ref.kind === "head" && (current === null || ref.name === "HEAD")) {
          // A detached HEAD: nothing to do with it as a branch.
          return [{ id: "checkout", label: t("graph.ref.checkout", { name: ref.name }), disabled: true, reason: t("graph.menu.alreadyCheckedOut") }];
        }
        const entry = list?.local.find((branch) => branch.name === ref.name) ?? bareBranch(ref.name, ref.name === current);
        return branchMenu(t, env, entry);
      }
      case "remote": {
        const known = list?.remote.find((branch) => branch.name === ref.name);
        const slash = ref.name.indexOf("/");
        const entry = known ?? { name: ref.name, remote: slash > 0 ? ref.name.slice(0, slash) : ref.name, branch: slash > 0 ? ref.name.slice(slash + 1) : ref.name };
        return remoteBranchMenu(t, env, entry);
      }
      case "tag":
        return tagMenu(t, env, ref.name);
      default:
        return [];
    }
  };

  return <RefMenuContext.Provider value={menuFor}>{children}</RefMenuContext.Provider>;
}
