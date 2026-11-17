// The commit graph: one row per commit, its lanes drawn on the left.
//
// A plugin cannot import an SVG library (inline SVG is for icons only), so a row's rail is built from plain views: a lane is a thin
// box, and a turn into or out of the dot is a box with two borders and one rounded corner.
// Rows are a fixed height, which is what lets the lanes of neighbouring rows meet.

import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Loading, copyText, useToast } from "@getpaseo/plugin/client/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import type { ViewStyle } from "react-native";
import { compareRpc, showRpc, syncRpc } from "../../shared/git";
import type { Ref, Scope } from "../../shared/git";
import { ago } from "./ago";
import * as codicon from "../ui/codicons";
import { showDiff } from "./diffTab";
import { FileTree } from "./Files";
import { key, useCommand } from "./git";
import { width } from "./lanes";
import type { Rail } from "./lanes";
import type { Pending, Row } from "./pending";
import { IconButton, Notice, T, Tint, isDark, useHint, useHost, useHoverCard, useRowHover } from "./ui";

const LANE = 12; // between two lanes
const LINE = 2;
const TURN = 7; // a turn's corner radius
const MOST = 10; // lanes drawn before the rail is cut off: the subject needs room too
const laneX = (lane: number) => 11 + lane * LANE; // a lane's centre
const railWidth = (lanes: number[]) => laneX(Math.min(width(lanes), MOST) - 1) + 10;

// VS Code's colours for the upstream and for the branch the checked-out one was made from
// (scmGraph.historyItemRemoteRefColor, scmGraph.historyItemBaseRefColor). The theme has no purple,
// so these are VS Code's own values: for the upstream, its dark or its light one by the panel's background.
const UPSTREAM = { dark: "#B180D7", light: "#652D90" };
const BASE = "#EA5C00";

/**
 * The refs the graph colours, as VS Code does: the checked-out branch, its upstream, and the branch it was made from;
 * with every branch shown, each other ref too, in its commit's lane colour. A ref left uncoloured is not shown.
 */
export interface Followed {
  upstream: string | null;
  base: string | null;
  all: boolean;
}

/** A lane keeps one colour all the way down. */
function usePaint() {
  const { c } = useHost();
  const palette = [c.accent, c.statusWarning, c.statusSuccess, c.statusDanger, c.foregroundMuted];
  return (lane: number) => palette[lane % palette.length];
}

function Rails({ rail, height, kind }: { rail: Rail; height: number; kind: "commit" | "merge" | "head" | "pending" }) {
  const { c } = useHost();
  const paint = usePaint();
  const mid = height / 2;
  const straight = (lane: number, top: number, bottom: number): ViewStyle => ({
    position: "absolute",
    left: laneX(lane) - LINE / 2,
    top,
    width: LINE,
    height: bottom - top,
    backgroundColor: paint(lane),
  });
  // From the dot sideways to a lane, then along it: upwards for a lane that ends here, downwards for one that starts.
  const turn = (lane: number, up: boolean): ViewStyle => {
    const right = lane > rail.col;
    const corner: ViewStyle = up
      ? { borderBottomWidth: LINE, ...(right ? { borderRightWidth: LINE, borderBottomRightRadius: TURN } : { borderLeftWidth: LINE, borderBottomLeftRadius: TURN }) }
      : { borderTopWidth: LINE, ...(right ? { borderRightWidth: LINE, borderTopRightRadius: TURN } : { borderLeftWidth: LINE, borderTopLeftRadius: TURN }) };
    return {
      position: "absolute",
      left: laneX(Math.min(lane, rail.col)) - LINE / 2,
      width: Math.abs(lane - rail.col) * LANE + LINE,
      top: up ? 0 : mid - LINE / 2,
      height: (up ? mid : height - mid) + LINE / 2,
      borderColor: paint(lane),
      ...corner,
    };
  };
  // A merge is a ringed dot, the checked-out commit an empty ring, the changes to pull or push a dashed one.
  const ring = kind !== "commit";
  const radius = ring ? 5.5 : 4;
  return (
    <View style={{ width: railWidth([rail.col, ...rail.through, ...rail.into, ...rail.out]), height, overflow: "hidden" }}>
      {rail.through.map((lane) => (
        <View key={"t" + lane} style={straight(lane, 0, height)} />
      ))}
      {rail.into.map((lane) => (
        <View key={"i" + lane} style={lane === rail.col ? straight(lane, 0, mid) : turn(lane, true)} />
      ))}
      {rail.out.map((lane) => (
        <View key={"o" + lane} style={lane === rail.col ? straight(lane, mid, height) : turn(lane, false)} />
      ))}
      <View
        style={{
          position: "absolute",
          left: laneX(rail.col) - radius,
          top: mid - radius,
          width: radius * 2,
          height: radius * 2,
          borderRadius: radius,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: ring ? c.surface0 : paint(rail.col),
          borderColor: paint(rail.col),
          // VS Code draws the changes to pull or push with a thin dashed stroke (1px, dashes of 4 and gaps of 2).
          borderWidth: kind === "pending" ? 1 : ring ? LINE : 0,
          borderStyle: kind === "pending" ? "dashed" : "solid",
        }}
      >
        {kind === "merge" && <View style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: paint(rail.col) }} />}
      </View>
    </View>
  );
}

/** On a row, the refs the graph colours; on a commit's card, as in VS Code's hover, every ref, the others plain. */
function Badges({ refs, rail, followed, card }: { refs: Ref[]; rail: Rail; followed: Followed; card?: boolean }) {
  const { c, small } = useHost();
  const paint = usePaint();
  const colour = (ref: Ref) => {
    if (ref.kind === "head") return c.accent;
    if (ref.kind !== "tag" && ref.name === followed.upstream) return isDark(c.surface0) ? UPSTREAM.dark : UPSTREAM.light;
    if (ref.kind === "remote" && ref.name === followed.base) return BASE;
    return followed.all ? paint(rail.col) : null;
  };
  // On a coloured badge VS Code writes in the panel's background colour; the checked-out branch keeps the theme's pair.
  const shown = refs.flatMap((ref) => {
    const fill = colour(ref);
    if (fill) return [{ ref, fill, ink: ref.kind === "head" ? c.accentForeground : c.surface0 }];
    return card ? [{ ref, fill: c.surface2, ink: c.foreground }] : [];
  });
  if (!shown.length) return null;
  const local = new Set(shown.filter(({ ref }) => ref.kind !== "remote" && ref.kind !== "tag").map(({ ref }) => ref.name));
  const icon = { head: codicon.target, branch: codicon.gitBranch, remote: codicon.cloud, tag: codicon.tag };
  return (
    <View style={card ? { flexDirection: "row", flexWrap: "wrap", gap: 4 } : { flexDirection: "row", flexShrink: 0, maxWidth: "55%", gap: 4, marginLeft: 6, overflow: "hidden" }}>
      {shown.map(({ ref, fill, ink }) => {
        // On a row, a remote branch sitting on its local branch says nothing new by name: VS Code shows a bare cloud.
        const mirror = !card && ref.kind === "remote" && local.has(ref.name.slice(ref.name.indexOf("/") + 1));
        return (
          <View
            key={ref.kind + ref.name}
            accessibilityLabel={`${ref.kind} ${ref.name}`}
            style={{ flexDirection: "row", alignItems: "center", gap: 3, height: small + 7, paddingHorizontal: 5, borderRadius: 9, backgroundColor: fill }}
          >
            <Icon icon={icon[ref.kind]} size={small} color={ink} />
            {!mirror && (
              <T size={small} color={ink} lines={1} style={{ maxWidth: 110 }}>
                {ref.name}
              </T>
            )}
          </View>
        );
      })}
    </View>
  );
}

interface ItemProps {
  cwd: string;
  workspaceId: string;
  commit: Row;
  rail: Rail;
  followed: Followed;
  open: boolean;
  onToggle: () => void;
}

/** A commit's row, or that of the changes to pull or to push, and under it its details while it is open. */
export function CommitItem({ cwd, workspaceId, commit, rail, followed, open, onToggle }: ItemProps) {
  const { c, row, small } = useHost();
  const rowHover = useRowHover();
  const head = commit.refs.some((ref) => ref.kind === "head");
  const kind = commit.pending ? "pending" : head ? "head" : commit.parents.length > 1 ? "merge" : "commit";
  // As in VS Code, a commit's message and the rest show on a card; the changes to pull or push have none.
  const hover = useHoverCard(() => <CommitCard cwd={cwd} commit={commit} rail={rail} followed={followed} />);
  return (
    <View>
      <Pressable
        {...(commit.pending ? {} : hover)}
        accessibilityRole="button"
        accessibilityLabel={`${commit.subject}, ${commit.author}`}
        aria-expanded={open}
        onPress={onToggle}
        style={(state) => [{ flexDirection: "row", alignItems: "center", height: row, paddingRight: 8 }, rowHover(state)]}
      >
        {open && <Tint color={c.accent} opacity={0.14} />}
        <Rails rail={rail} height={row} kind={kind} />
        <T lines={1} weight={head ? "600" : undefined} style={{ flexShrink: 1, minWidth: 0 }}>
          {commit.subject}
        </T>
        <T size={small} color={c.foregroundMuted} lines={1} style={{ flexShrink: 1000, minWidth: 0, marginLeft: 8 }}>
          {commit.author}
        </T>
        <View style={{ flex: 1 }} />
        <Badges refs={commit.refs} rail={rail} followed={followed} />
      </Pressable>
      {open &&
        (commit.pending ? <PendingDetails cwd={cwd} workspaceId={workspaceId} pending={commit.pending} rail={rail} /> : <Details cwd={cwd} workspaceId={workspaceId} commit={commit} rail={rail} />)}
    </View>
  );
}

/** As in VS Code, an open commit lists the files it changed. */
function Details({ cwd, workspaceId, commit, rail }: Pick<ItemProps, "cwd" | "workspaceId" | "commit" | "rail">) {
  const detail = useCommit(cwd, commit.hash);
  return (
    <Under rail={rail}>
      {detail.error ? (
        <Notice failed>{detail.error.message}</Notice>
      ) : !detail.data ? (
        <Loading />
      ) : (
        <FileTree files={detail.data.files} indent={0} onOpen={(file) => showDiff({ workspaceId, cwd, source: { kind: "commit", hash: commit.hash }, file })} />
      )}
    </Under>
  );
}

/** A commit's message, files and how much it changed. Read once: a commit never changes. */
function useCommit(cwd: string, hash: string) {
  const read = useRpc(showRpc);
  return useQuery({ queryKey: key("show", cwd, hash), queryFn: () => read({ cwd, hash }), staleTime: Infinity });
}

/** What VS Code's hover over a commit shows: who made it and when, its message, how much it changed, its refs and its hash. */
function CommitCard({ cwd, commit, rail, followed }: Pick<ItemProps, "cwd" | "commit" | "rail" | "followed">) {
  const { c, small } = useHost();
  const toast = useToast();
  const detail = useCommit(cwd, commit.hash);
  const when = commit.time * 1000;
  const date = new Date(when).toLocaleString("en-US", { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "numeric" });
  const icon = small + 3;
  const line = icon + 6; // the first line of the author's row, which its icons sit in the middle of
  const rule = <View style={{ height: 1, backgroundColor: c.border }} />;
  const copy = () =>
    copyText(commit.hash).then(
      () => toast.show("Commit hash copied", { variant: "success" }),
      (error: Error) => toast.error(error.message),
    );
  return (
    <View style={{ gap: 8 }}>
      {/* The time wraps in its own column, so that its icon stays in front of it. */}
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 4 }}>
        <View style={{ height: line, justifyContent: "center" }}>
          <Icon icon={codicon.account} size={icon} color={c.foreground} />
        </View>
        <T weight="600" style={{ lineHeight: line }}>{`${commit.author},`}</T>
        <View style={{ height: line, justifyContent: "center" }}>
          <Icon icon={codicon.history} size={icon} color={c.foreground} />
        </View>
        <T style={{ flexShrink: 1, lineHeight: line }}>{`${ago(when)} (${date})`}</T>
      </View>
      {detail.error ? (
        <Notice failed>{detail.error.message}</Notice>
      ) : !detail.data ? (
        <Loading />
      ) : (
        <>
          <T selectable>{detail.data.message}</T>
          {rule}
          {detail.data.stats.files > 0 && (
            <>
              <Stats {...detail.data.stats} />
              {rule}
            </>
          )}
        </>
      )}
      {commit.refs.length > 0 && (
        <>
          <Badges refs={commit.refs} rail={rail} followed={followed} card />
          {rule}
        </>
      )}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Icon icon={codicon.gitCommit} size={icon} color={c.foregroundMuted} />
        <T mono size={small}>
          {commit.hash.slice(0, 7)}
        </T>
        <IconButton icon={codicon.copy} label="Copy Commit Hash" onPress={copy} />
      </View>
    </View>
  );
}

/** "3 files changed, 7 insertions(+), 1 deletion(-)", in VS Code's words and colours, leaving out a count of nothing. */
function Stats({ files, insertions, deletions }: { files: number; insertions: number; deletions: number }) {
  const { c } = useHost();
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  return (
    <T>
      {`${plural(files, "file")} changed`}
      {insertions > 0 && <T color={c.statusSuccess}>{`, ${plural(insertions, "insertion")}(+)`}</T>}
      {deletions > 0 && <T color={c.statusDanger}>{`, ${plural(deletions, "deletion")}(-)`}</T>}
    </T>
  );
}

/** The files the changes to pull or to push touch, from where the branch and its upstream parted. */
function PendingDetails({ cwd, workspaceId, pending, rail }: Pick<ItemProps, "cwd" | "workspaceId" | "rail"> & { pending: Pending }) {
  const read = useRpc(compareRpc);
  const { from, to } = pending;
  const files = useQuery({ queryKey: key("compare", cwd, from, to), queryFn: () => read({ cwd, from, to }), staleTime: Infinity });
  return (
    <Under rail={rail}>
      {files.error ? (
        <Notice failed>{files.error.message}</Notice>
      ) : !files.data ? (
        <Loading />
      ) : (
        <FileTree files={files.data.files} indent={0} onOpen={(file) => showDiff({ workspaceId, cwd, source: { kind: pending.kind, from, to }, file })} />
      )}
    </Under>
  );
}

/** What shows under an open row: the lanes alive under it run on beside it, however tall it gets. */
function Under({ rail, children }: { rail: Rail; children: ReactNode }) {
  const { c } = useHost();
  const paint = usePaint();
  return (
    <View style={{ flexDirection: "row" }}>
      <Tint color={c.accent} opacity={0.06} />
      <View style={{ width: railWidth(rail.below), overflow: "hidden" }}>
        {rail.below.map((lane) => (
          <View key={lane} style={{ position: "absolute", left: laneX(lane) - LINE / 2, top: 0, bottom: 0, width: LINE, backgroundColor: paint(lane) }} />
        ))}
      </View>
      <View style={{ flex: 1, minWidth: 0, paddingVertical: 6, gap: 4 }}>{children}</View>
    </View>
  );
}

/** The buttons in the graph's title bar: they pick its branches and reach the remote. */
export function GraphActions({ cwd, scope, onScope }: { cwd: string; scope: Scope; onScope: (scope: Scope) => void }) {
  const { c, small } = useHost();
  const toast = useToast();
  const queries = useQueryClient();
  const sync = useCommand(syncRpc, cwd);
  const run = (action: "fetch" | "pull" | "push", done: string) => sync.mutate({ action }, { onSuccess: () => toast.show(done, { variant: "success" }) });
  const scopeHint = useHint(scope === "all" ? "All branches are shown. Show only the current branch and its upstream" : "The current branch and its upstream are shown. Show all branches");
  return (
    <>
      <Pressable
        {...scopeHint}
        accessibilityRole="button"
        accessibilityLabel={scope === "all" ? "Showing all branches. Show the current branch only" : "Showing the current branch. Show all branches"}
        hitSlop={4}
        onPress={() => onScope(scope === "all" ? "current" : "all")}
        style={{ flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 4 }}
      >
        <Icon icon={codicon.gitBranch} size={small + 3} color={c.foregroundMuted} />
        <T size={small} color={c.foregroundMuted}>
          {scope === "all" ? "All" : "Auto"}
        </T>
      </Pressable>
      <IconButton icon={codicon.gitFetch} label="Fetch" disabled={sync.isPending} onPress={() => run("fetch", "Fetched")} />
      <IconButton icon={codicon.repoPull} label="Pull" disabled={sync.isPending} onPress={() => run("pull", "Pulled")} />
      <IconButton icon={codicon.repoPush} label="Push" disabled={sync.isPending} onPress={() => run("push", "Pushed")} />
      <IconButton icon={codicon.refresh} label="Refresh" onPress={() => void queries.invalidateQueries({ queryKey: key() })} />
    </>
  );
}
