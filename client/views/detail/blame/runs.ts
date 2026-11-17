// Blame's lines grouped into runs: consecutive lines last changed by the same commit, which the gutter labels once, on
// the run's first line. And each commit's age as a shade level, newest darkest, as GitLens and VS Code's blame shade it.
// Pure: unit-tested (test/unit/client/blameRuns.test.ts).

/** A line as git.history.blame lists it. */
export interface BlameLine {
  line: number;
  hash: string;
  originalLine: number;
}

/** Lines `start` (inclusive) to `end` (exclusive), indexes into the lines, all last changed by `hash`. */
export interface BlameRun {
  hash: string;
  start: number;
  end: number;
}

export function blameRuns(lines: readonly BlameLine[]): BlameRun[] {
  const runs: BlameRun[] = [];
  lines.forEach((line, index) => {
    const last = runs[runs.length - 1];
    if (last && last.hash === line.hash && last.end === index) last.end = index + 1;
    else runs.push({ hash: line.hash, start: index, end: index + 1 });
  });
  return runs;
}

/** For each line, the index of its run in `runs`. */
export function runIndexes(runs: readonly BlameRun[], count: number): number[] {
  const indexes = new Array<number>(count).fill(-1);
  runs.forEach((run, at) => {
    for (let n = run.start; n < run.end && n < count; n++) indexes[n] = at;
  });
  return indexes;
}

/**
 * Each commit's age as a level from 0 (oldest) to `levels - 1` (newest), by its rank among the commits blamed. Hashes
 * with no time (lines not committed yet) are the newest.
 */
export function ageLevels(times: ReadonlyMap<string, number | null>, levels: number): Map<string, number> {
  const top = Math.max(0, Math.floor(levels) - 1);
  const dated = [...new Set([...times.values()].filter((time): time is number => time !== null))].sort((a, b) => a - b);
  const rank = new Map(dated.map((time, index) => [time, index]));
  const result = new Map<string, number>();
  for (const [hash, time] of times) {
    if (time === null) result.set(hash, top);
    else result.set(hash, dated.length <= 1 ? top : Math.round(((rank.get(time) ?? 0) / (dated.length - 1)) * top));
  }
  return result;
}
